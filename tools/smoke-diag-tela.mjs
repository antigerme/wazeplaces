// Valida o `tools/diag-tela.mjs` do jeito mais duro que existe: dirige o app de
// VERDADE e, em cada estado, tira a tela AO VIVO no mesmo instante em que o FAB
// captura. Depois remonta o diagnóstico e compara as duas imagens PIXEL A PIXEL.
// E, com o mesmo relatório, confere o `tools/diag-replay.mjs`.
//
// Por que assim, e não "abri e pareceu certo": duas versões do diag-tela
// entregaram imagem SEM ESTILO, com zero erro e zero aviso — a tela errada com
// cara de certa. Olho não pega isso quando não há com o que comparar. A tela ao
// vivo é o gabarito, e a diferença percentual é o número que decide.
//
//   npm run test:diag-tela                        # API de mentira, sem Waze
//   node tools/smoke-diag-tela.mjs <cookies.txt>  # o Waze de verdade, com os cookies do owner
//
// SEM COOKIES ele roda com uma API DE MENTIRA (a regra dos outros smokes): até a
// auditoria de 2026-09-26 ele só existia com os cookies do owner e o Waze real,
// e ninguém o rodava — e ele tinha apodrecido em três pontos sem ninguém ver: o
// servidor subia no clone ERRADO (`/home/user/wazeplaces`, cravado), o download
// era lido como JSON (o relatório é ZIP desde v2026.09.10-04) e o download era
// pedido SEGURANDO o FAB (que desde v2026.09.10-03 só pega o botão). O que ele
// mede — a remontagem contra a tela — não depende do Waze.
//
// O valor do cookie NUNCA é ecoado: entra por `page.evaluate` (que não repete o
// argumento no log de erro, ao contrário do `page.fill`) dentro de try/catch que
// não repassa a mensagem crua.
import { carregarPlaywright, abrirChromium } from './navegador.mjs';
import { lerDiagnostico } from './diag-ler.mjs';
import { esperarOuExplodir } from './esperar-saida.mjs';
import { execFileSync } from 'node:child_process';
import { subirServidorLocal } from './servidor-local.mjs';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COOKIES = process.argv[2] || null;
const PORT = Number(process.env.SMOKE_DIAG_PORT || 8241), BASE = `http://127.0.0.1:${PORT}`;
const SAIDA = '/tmp/smoke-diag-tela';
rmSync(SAIDA, { recursive: true, force: true });
mkdirSync(SAIDA, { recursive: true });

let falhas = 0;
const checa = (ok, oq, detalhe = '') => {
  if (!ok) { falhas++; console.log(`  ✗ ${oq}${detalhe ? ' — ' + detalhe : ''}`); }
  else console.log(`  ✓ ${oq}`);
};

// O servidor sobe por `tools/servidor-local.mjs`: a porta tem que estar LIVRE
// antes, e pronto é o próprio processo dizer que a ocupou — senão um servidor
// esquecido responderia no lugar do meu, e o smoke mediria o app ERRADO.
const { servidor: srv } = await subirServidorLocal({ porta: PORT, variavel: 'SMOKE_DIAG_PORT', stderr: 'ignore',
  env: COOKIES ? {} : { ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64') } });

const browser = await abrirChromium(await carregarPlaywright());

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

// ── o app, de verdade ─────────────────────────────────────────────────────
// Sistema ESCURO e nada guardado: o app segue o sistema, que é o padrão de
// quem nunca tocou no botão de tema — e é o caso que o diag-replay remontava
// claro (auditoria de 2026-09-26). O "tema trocado" abaixo cobre o claro.
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  acceptDownloads: true, serviceWorkers: 'block', colorScheme: 'dark', locale: 'pt-BR',
});
// Imagem de TERCEIRO bloqueada também AO VIVO. A remontagem corta rede por
// projeto (recurso que carregasse AQUI e não no aparelho dele daria uma imagem
// que ninguém viu), então deixar a foto do Waze carregar só de um lado mede a
// FOTO, não a fidelidade: medido, dava 46% de diferença só por causa dela.
// Bloqueando nos dois, o que sobra na conta é o que a ferramenta promete
// remontar — o desenho do próprio app.
await ctx.route('**/*', (r) => {
  const u = r.request().url();
  const tipo = r.request().resourceType();
  return (tipo === 'image' && !u.startsWith(BASE)) ? r.abort() : r.continue();
});
if (!COOKIES) {
  // A API DE MENTIRA: pedidos REAIS dos países de validação (a fixture), um
  // perfil L6+AM, e o resto vazio. Registrada DEPOIS da de cima, então vale
  // primeiro pra `/api/*` (o Playwright tenta a rota mais nova antes).
  const FIX = JSON.parse(readFileSync(join(ROOT, 'tools', 'fixtures-paises.json'), 'utf8'));
  const PERFIL = { id: 4242, userName: 'smoke', rank: 5, isAreaManager: true, isStaff: false,
                   editableCountryIDs: [30], areas: [], managedAreas: [] };
  await ctx.route('**/api/**', async (r) => {
    const nome = r.request().url().split('/api/')[1].split(/[?#]/)[0];
    let b = { success: true };
    if (nome === 'perfil') b = { success: true, profile: PERFIL, visivelNoWme: true };
    else if (nome === 'buscar-places') b = { success: true, places: FIX.slice(0, 6), hasMore: false, page: 1, total: 6, totalAll: 6, blocked: 0 };
    else if (nome === 'lista-paises') b = { success: true, countries: [{ id: 30, name: 'Brazil' }] };
    else if (nome === 'lista-estados') b = { success: true, states: [] };
    else if (nome === 'presenca-app') b = { success: true, online: [], conversas: [] };
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  });
  await ctx.addInitScript(() => {
    try {
      if (!localStorage.getItem('__smoke')) {
        localStorage.setItem('__smoke', '1');
        localStorage.setItem('waze_session_token', 'tok-smoke-diag-tela');
        localStorage.setItem('waze_places_preferences', JSON.stringify({ undoEnabled: true, presenca: false, comoFuncionaVisto: true }));
      }
    } catch (e) {}
  });
}
const page = await ctx.newPage();
const errosJs = [];
page.on('pageerror', (e) => errosJs.push(String(e.message || e).slice(0, 120)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await esperarOuExplodir(page, () => typeof AppState !== 'undefined', 'o app carregar');

if (COOKIES) {
  await page.click('#pasteBtn'); await page.waitForTimeout(250);
  try {
    await page.evaluate((v) => {
      const el = document.getElementById('cookiesTextarea');
      el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
    }, readFileSync(COOKIES, 'utf8'));
  } catch (e) { console.error('falha ao preencher (mensagem suprimida de propósito)'); process.exit(1); }
  await page.click('#confirmPaste');
}
await esperarOuExplodir(page, () => document.getElementById('authScreen').classList.contains('hidden')
  && (!!document.querySelector('.place-card') || !document.getElementById('noMoreCards').classList.contains('hidden')),
  'entrar e a fila chegar', 60000);
if (await page.evaluate(() => !document.getElementById('comoFuncionaModal').classList.contains('hidden')))
  await page.click('#comoFuncionaOk');
await page.waitForTimeout(600);
console.log(`login ok (${COOKIES ? 'Waze de verdade' : 'API de mentira'}) · fila:`, await page.evaluate(() => AppState.queue.length));

// dev: 7 toques + interruptor
await page.click('#helpBtn'); await page.waitForTimeout(250);
for (let i = 0; i < 7; i++) { await page.click('#appVersionDisplay'); await page.waitForTimeout(60); }
await page.evaluate(() => closeModal('helpModal')); await page.waitForTimeout(200);
await page.click('#filtersBtn'); await page.waitForTimeout(250);
await page.click('#filtersTabPrefs').catch(() => {});
await page.waitForTimeout(150);
await page.click('#prefDevModeActive'); await page.waitForTimeout(300);
await page.evaluate(() => closeModal('filtersModal')); await page.waitForTimeout(400);
checa(await page.evaluate(() => AppState.devMode.active === true), 'PRÉ-CONDIÇÃO: o modo dev ligou pelos toques');

// Captura: a tela AO VIVO e o momento, no mesmo instante. O FAB é escondido no
// print ao vivo E na remontagem (ele é do instrumento, não do app) — comparar
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

// tema trocado (o diagnóstico tem que trazer o tema junto)
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

// Os dois toques no botão de tema deixaram uma escolha GUARDADA. Tirá-la volta
// o app a seguir o sistema (escuro), que é o estado que o relatório tem que
// levar pro diag-replay remontar (ver o bloco do replay, no fim).
await page.evaluate(() => { localStorage.removeItem('waze_places_theme'); applyTheme(getPreferredTheme()); });
await page.waitForTimeout(200);

// ── baixa e remonta ───────────────────────────────────────────────────────
// Pelo botão de verdade (Filtros → Avançado): segurar o FAB só PEGA o botão
// desde v2026.09.10-03, e o smoke seguia esperando um download que não vinha.
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  page.evaluate(() => baixarDiagnostico()),
]);
const zip = join(SAIDA, 'diag.zip');
await dl.saveAs(zip);
const { dados: d, origem } = lerDiagnostico(zip);
console.log(`\ndiagnóstico: ${Math.round(readFileSync(zip).length / 1024)} KB (${origem}) · `
  + `${(d.momentos || []).length} momentos\n`);

// `--cru`: sem as marcas do instrumento (hachura, molduras). Elas são anotação
// da ferramenta, não desenho do app — com elas ligadas a conta media a anotação.
execFileSync(process.execPath, ['tools/diag-tela.mjs', zip, join(SAIDA, 'remontado'), '--cru'],
  { cwd: ROOT, stdio: 'inherit' });

// O FAB tem que sumir da remontagem também, senão ele conta como diferença.
// (O tool o marca com moldura; aqui o alvo é comparar o APP.)
console.log('\n── remontagem × tela ao vivo ──');
// Só os momentos MANUAIS pareiam com as capturas: a captura AUTOMÁTICA (erro de
// JS, painel de falha) entra sozinha e é o recurso funcionando — casar 1:1 com
// os toques media o instrumento, não o app.
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
  // 8% é folga pra sombra e antialias — a falha que se quer pegar (CSS inteiro
  // sumindo) dá 60%+ e não passa nem perto.
  checa(r.pct <= 8, `${aoVivo[i].nome}: ${r.pct}% de pixels diferentes`,
    r.pct > 8 ? `${r.largura}x${r.altura}` : '');
}

// ── conferências que a imagem sozinha não dá ──────────────────────────────
console.log('\n── o que a imagem não mostra ──');
const resumoTela = JSON.parse(readFileSync(join(SAIDA, 'remontado', 'resumo.json'), 'utf8'));
for (let i = 0; i < momentos.length; i++) {
  const html = readFileSync(join(SAIDA, 'remontado', `.momento-${idx[i] + 1}.html`), 'utf8');
  const p = await browser.newPage();
  await p.goto('file://' + join(SAIDA, 'remontado', `.momento-${idx[i] + 1}.html`), { waitUntil: 'load' });
  const est = await p.evaluate(async () => {
    await document.fonts.ready;
    return {
      folhas: document.styleSheets.length,
      // SOMA de todas as folhas: olhar só `[0]` mediria a folha errada.
      regras: [...document.styleSheets].reduce((a, f) => {
        try { return a + f.cssRules.length; } catch (e) { return a; }
      }, 0),
      fundo: getComputedStyle(document.body).backgroundColor,
      // A FONTE CARREGOU — e não "a família DECLARADA contém Inter", que é o
      // que se lia antes: o CSS do app pede `Inter` sempre, então aquela
      // conferência passava com a fonte do sistema na tela (auditoria de
      // 2026-09-26). `check` sozinho não basta: com NENHUMA face da família ele
      // devolve verdadeiro. Por isso a face tem que existir E ter carregado.
      interCarregou: document.fonts.check('16px Inter'),
      facesInter: [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Inter').map((f) => f.status),
      scripts: document.querySelectorAll('script').length,
      canvas: document.querySelectorAll('canvas').length,
    };
  });
  await p.close();
  if (i === 0) {
    checa(est.folhas > 0 && est.regras > 100,
      `o CSS chega ao documento (${est.folhas} folha(s), ${est.regras} regras)`,
      'foi este o defeito que entregou imagem sem estilo duas vezes');
    checa(est.fundo !== 'rgba(0, 0, 0, 0)', `o corpo tem fundo pintado (${est.fundo})`);
    checa(est.scripts === 0, 'nenhum script sobrou — a remontagem não re-executa o app');
    checa(est.canvas === 0, 'todo canvas virou imagem — pixel de canvas não vive no DOM');
  }
  checa(est.interCarregou && est.facesInter.includes('loaded'),
    `momento ${i + 1}: a Inter CARREGOU na remontagem (não a fonte do sistema)`, JSON.stringify(est.facesInter));
  // O painel que o momento DIZ que estava visível é o que aparece na remontagem.
  const m = momentos[i];
  const painelNoHtml = /id="loadErrorState"[^>]*class="(?![^"]*hidden)/.test(html) ? 'falhaAoCarregar'
    : /id="noMoreCards"[^>]*class="(?![^"]*hidden)/.test(html) ? 'tudoLimpo'
    : /class="[^"]*place-card/.test(html) ? 'card' : 'nada';
  checa(painelNoHtml === m.painel || m.painel === 'card',
    `momento ${i + 1} (${aoVivo[i] ? aoVivo[i].nome : '?'}): o painel bate (${m.painel})`,
    `remontado mostra ${painelNoHtml}`);
}
checa(resumoTela.fontesEmbutidas.length > 0 && resumoTela.momentos.every((l) => l.fonte === 'Inter')
  && !resumoTela.ressalvas.some((r) => /fonte/.test(r)),
  'o resumo da remontagem diz a verdade sobre a fonte (embutida, e carregou em todo momento)',
  JSON.stringify({ fontes: resumoTela.fontesEmbutidas, porMomento: resumoTela.momentos.map((l) => l.fonte), ressalvas: resumoTela.ressalvas }));

// Idioma e tema viajam junto?
const iFr = aoVivo.findIndex((a) => a.nome === 'interface em francês');
const htmlFr = readFileSync(join(SAIDA, 'remontado', `.momento-${idx[iFr] + 1}.html`), 'utf8');
checa(/Filtres|Aide|Passer/i.test(htmlFr), 'o momento em francês remonta EM FRANCÊS');

checa(errosJs.length === 0, 'zero erro de JS no app durante toda a bateria', errosJs[0] || '');

// ── relatório SEM captura ─────────────────────────────────────────────────
// Quem baixa sem tocar no botão manda só o `dom` da hora de baixar, e a
// remontagem o rotulava "arquivo v1 · painel=?" num relatório v10. O mesmo
// relatório, sem as capturas: o rótulo tem que dizer a versão DELE e o painel
// que ele mediu.
console.log('\n── relatório sem captura ──');
const semCaptura = join(SAIDA, 'sem-captura.json');
writeFileSync(semCaptura, JSON.stringify({ ...d, momentos: [], aberturasAnteriores: [] }));
execFileSync(process.execPath, ['tools/diag-tela.mjs', semCaptura, join(SAIDA, 'sem-captura')],
  { cwd: ROOT, stdio: 'pipe' });
const rSem = JSON.parse(readFileSync(join(SAIDA, 'sem-captura', 'resumo.json'), 'utf8'));
const m0 = (rSem.momentos || [])[0] || {};
checa(rSem.momentos.length === 1 && String(m0.motivo).includes(`relatório v${d._versaoDoDiag}`)
  && m0.painel === (d.resumo && d.resumo.telaAgora && d.resumo.telaAgora.painel) && m0.painel !== '?',
  `a tela da hora de baixar sai com a versão do relatório e o painel medido (${m0.motivo} · ${m0.painel})`,
  JSON.stringify(m0));

// ── o diag-replay, com o MESMO relatório ──────────────────────────────────
// Ele reconstrói a tela VIVA, e três coisas saíam diferentes do aparelho
// (auditoria de 2026-09-26): o tema de quem segue o sistema escuro (remontava
// claro), o cabeçalho (sem perfil, Filtros e Atualizar) e a sessão (sem token,
// e ele imprimia o alerta `tokenNaoPersiste`, que o aparelho não tinha).
console.log('\n── diag-replay ──');
checa(d.ambiente && d.ambiente.escuro === true && !(d.localStorage || {}).waze_places_theme
  && /(^|\s)dark(\s|$)/.test(d.computado && d.computado.tema && d.computado.tema.htmlClasse),
  'PRÉ-CONDIÇÃO: o relatório é de quem segue o sistema ESCURO, sem escolha guardada',
  JSON.stringify({ escuro: d.ambiente && d.ambiente.escuro, tema: d.computado && d.computado.tema }));
const portaLivre = await new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
let replay = '';
try {
  replay = execFileSync(process.execPath, ['tools/diag-replay.mjs', zip, '--tela', '--porta', String(portaLivre)],
    { cwd: ROOT, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) { replay = String(e.stdout || '') + '\nFALHOU: ' + String(e.message).slice(0, 200); }
checa(/tema escuro \(o da tela\)/.test(replay) && /tema na tela escuro/.test(replay),
  'o replay remonta o tema ESCURO de quem segue o sistema', (replay.match(/^tela: .*|^painel: .*/gm) || []).join(' / '));
checa(/cabeçalho: perfil "[^"]+" · Filtros sim · Atualizar sim/.test(replay),
  'o replay monta o cabeçalho (perfil, Filtros e Atualizar)', (replay.match(/cabeçalho: .*/) || [replay.slice(-200)])[0]);
checa(/alertas: nenhum/.test(replay) && !/tokenNaoPersiste/.test(replay),
  'o replay não inventa o alerta `tokenNaoPersiste`', (replay.match(/alertas: .*/) || [''])[0]);
checa(existsSync(zip + '-replay.png'), 'o replay salvou a tela');

// O PLACAR do aparelho (auditoria de 2026-09-29, T3): a remontagem mostrava
// 0 · 0 · 0 e, no "Restam", o tamanho do recorte injetado. Aqui o MESMO
// relatório com um placar CONHECIDO, e o CONTROLE sem os campos (a forma dos
// relatórios antigos): se a linha não mudar entre os dois, ela não vem da tela.
// Fila de 6 pedidos, acima do limiar da busca adiantada: com "há mais" e fila
// curta o app pediria a página seguinte, e o replay corta a rede.
const FILA_T3 = JSON.parse(readFileSync(join(ROOT, 'tools', 'fixtures-paises.json'), 'utf8')).slice(0, 6)
  .map((p, i) => ({ ...p, venueID: 't3.' + i, updateRequestID: 't3u' + i }));
const replayDoPlacar = async (placar, nome) => {
  const { stats, serverTotal, hasMore, ...resto } = d.appState || {};
  const arq = join(SAIDA, nome + '.json');
  writeFileSync(arq, JSON.stringify({ ...d, momentos: [], aberturasAnteriores: [],
    appState: { ...resto, queue: FILA_T3, currentPlaceIdx: 0, loadError: false, ...placar } }));
  const porta = await new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
  let saida = '';
  try {
    saida = execFileSync(process.execPath, ['tools/diag-replay.mjs', arq, '--tela', '--porta', String(porta)],
      { cwd: ROOT, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { saida = String(e.stdout || '') + '\nFALHOU: ' + String(e.message).slice(0, 200); }
  return ((saida.match(/^placar: .*$/m) || [saida.slice(-200)])[0]).trim();
};
const placarCheio = await replayDoPlacar({ stats: { read: 801, rejected: 905, skipped: 18 }, serverTotal: 311, hasMore: true }, 'placar-cheio');
checa(/lidos 801 · rejeitados 905 · pulados 18 · restam 311\+$/.test(placarCheio),
  'o replay remonta o PLACAR do aparelho: Lidos, Rejeitados, Pulados e o "Restam" com o "+"', placarCheio);
const placarAusente = await replayDoPlacar({}, 'placar-ausente');
checa(/lidos 0 · rejeitados 0 · pulados 0 · restam 6$/.test(placarAusente),
  'CONTROLE: relatório sem placar remonta como antes (zerado, o "Restam" do recorte) — a linha vem da tela', placarAusente);

// ── o caminho de ABORTO ───────────────────────────────────────────────────
console.log('\n── recusa de entregar imagem errada ──');
const quebrado = join(SAIDA, 'quebrado.json');
writeFileSync(quebrado, JSON.stringify({
  app: { rotulo: 'x' }, ambiente: { tela: { janela: '390x844', dpr: 2 } },
  codigo: { 'https://x/css/app.css': { tipo: 'text/css', corpo: 'body{color:red}' } },
  dom: '<html><head><title>t</title><!-- comentário que nunca fecha </head><body>oi</body></html>',
}));
let saiu = 0;
try { execFileSync(process.execPath, ['tools/diag-tela.mjs', quebrado, join(SAIDA, 'aborto')],
  { cwd: ROOT, stdio: 'pipe' }); }
catch (e) { saiu = e.status; }
checa(saiu === 1, 'CSS num ponto irrenderizável faz a ferramenta ABORTAR', `saiu ${saiu}`);
let pngs = 0;
try { pngs = readdirSync(join(SAIDA, 'aborto')).filter((f) => f.endsWith('.png')).length; }
catch (e) {}
checa(pngs === 0, 'e não deixa nenhum PNG pra trás — imagem errada é pior que imagem nenhuma');

await browser.close(); srv.kill();
console.log(falhas === 0
  ? `\n✓ diag-tela: ${aoVivo.length} estados remontados e conferidos contra a tela ao vivo, e o diag-replay com o mesmo relatório`
  : `\n✗ ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
