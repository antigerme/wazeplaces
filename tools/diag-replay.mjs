// Reconstrói a TELA do editor a partir de um diagnóstico do modo dev, viva e
// manipulável — não uma imagem.
//
//   node tools/diag-replay.mjs <arquivo.json> [--porta 8123] [--tela] [--tudo]
//
// POR QUE ISTO EXISTE. O `diag-tela.mjs` remonta uma FOTO do momento (DOM
// congelado, sem JS, sem rede) e responde "o que ele via". Esta ferramenta
// responde outra pergunta: "e se eu mexer?". Ela sobe o app de verdade, injeta a
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
import { subirServidorLocal } from './servidor-local.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// O TEMA que a pessoa via, e de onde ele vem. Só o GUARDADO era lido — e quem
// segue o sistema (o padrão: nada guardado até tocar no botão) num celular
// escuro remontava CLARO, com o init abaixo ainda gravando "light" por cima
// (auditoria de 2026-09-26). A ordem: a escolha guardada; senão o que a TELA
// mostrava (`computado.tema.htmlClasse`, relatório v3+); senão o sistema do
// aparelho (`ambiente.escuro`). `sistema` é o esquema do APARELHO, que vai pro
// contexto do navegador: sem escolha guardada, o app o segue sozinho.
function temaDoRelatorio(d) {
  const guardado = /^"?(dark|light)"?$/.exec(String(((d && d.localStorage) || {}).waze_places_theme || ''));
  const classe = d && d.computado && d.computado.tema && d.computado.tema.htmlClasse;
  const sistema = d && d.ambiente && typeof d.ambiente.escuro === 'boolean' ? d.ambiente.escuro : null;
  if (guardado) return { escuro: guardado[1] === 'dark', guardado: guardado[1], sistema, origem: 'escolhido' };
  if (typeof classe === 'string') return { escuro: /(^|\s)dark(\s|$)/.test(classe), guardado: null, sistema, origem: 'o da tela' };
  return { escuro: sistema === true, guardado: null, sistema, origem: sistema === null ? 'padrão' : 'o do sistema' };
}

// O PLACAR que a pessoa via: Lidos, Rejeitados, Pulados e o "Restam" (com o
// "+" quando havia mais). A remontagem mostrava 0 · 0 · 0 e o tamanho do
// recorte injetado, onde o aparelho tinha 801 · 905 · 18 · 20+ (auditoria de
// 2026-09-29, T3) — e o "Restam" é justamente o número que um relato de "a fila
// acabou" discute. Relatório sem os campos (antigo, ou montado à mão) fica como
// era: placar zerado, e o "Restam" no tamanho da fila injetada.
function placarDoRelatorio(st, naFila) {
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);
  const s = (st && st.stats) || {};
  return {
    stats: { read: n(s.read), rejected: n(s.rejected), skipped: n(s.skipped) },
    serverTotal: st && Number.isFinite(st.serverTotal) && st.serverTotal >= 0 ? st.serverTotal : naFila,
    hasMore: !!(st && st.hasMore === true),
  };
}

// A FILA que a remontagem injeta, e o pedido da frente. Com o TREINO aberto na
// hora do relatório, o `appState.queue` são os EXEMPLOS (os clones inertes e os
// sintéticos): a remontagem os punha como a fila, sem a faixa do treino e sem
// dizer nada — com 40 pedidos reais, injetava 30 exemplos e mostrava "restam 40"
// (auditoria da rodada 9, R9-4-08, MEDIDO). A fila REAL é a que o treino guarda,
// e o relatório a leva desde o v11 (`treino.fila`, com o `currentPlaceIdx` dela,
// R8-4-06): é ela que entra, e `doTreino` diz que foi assim. O placar e o
// "Restam" do `appState` já são os da fila real (o treino tem placar próprio).
function filaDoRelatorio(d) {
  const st = (d && d.appState) || {};
  const tr = d && d.treino && typeof d.treino === 'object' ? d.treino : null;
  const doTreino = !!(tr && tr.ativo === true && Array.isArray(tr.fila));
  if (doTreino) {
    const fila = tr.fila.filter((x) => x && typeof x === 'object');
    const i = tr.currentPlaceIdx;
    return { fila, idx: Number.isInteger(i) && i >= 0 && i < fila.length ? i : 0, doTreino, exemplos: (st.queue || []).length };
  }
  // `currentPlace` virou ÍNDICE no formato 3+. Nos formatos antigos ele é um
  // objeto e o `queue[0]` pode ter saído como a string "[circular]" — o mesmo
  // objeto serializado duas vezes. Os dois casos são remendados aqui.
  // MIGRACAO: diag-formato-2 — ver tools/migracoes.mjs
  const fila = (st.queue || []).map((x) => (x === '[circular]' ? st.currentPlace : x)).filter(Boolean);
  const idx = Number.isInteger(st.currentPlaceIdx) && st.currentPlaceIdx >= 0 ? st.currentPlaceIdx : 0;
  return { fila, idx, doTreino: false, exemplos: 0 };
}

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
const { fila, idx, doTreino, exemplos } = filaDoRelatorio(d);
const LIMITE = args.includes('--tudo') ? fila.length : 30;
const recorte = fila.slice(idx, idx + LIMITE);

const [W, H] = String((d.ambiente && d.ambiente.tela && d.ambiente.tela.janela) || '390x844')
  .split('x').map((n) => parseInt(n, 10) || 0);
const dpr = (d.ambiente && d.ambiente.tela && d.ambiente.tela.dpr) || 2;
const tema = temaDoRelatorio(d);
const escuro = tema.escuro;
const lang = (d.app && d.app.idioma) || 'pt';
const PORTA = parseInt(opt('porta', '8123'), 10);

console.log(`de:      ${ARQ.split('/').pop()}   (${_origemDoDiag})`);
console.log(`app:     ${(d.app && d.app.rotulo) || '?'}   formato ${d._formato || '?'}`);
console.log(`tela:    ${W}x${H} @${dpr}x · tema ${escuro ? 'escuro' : 'claro'} (${tema.origem}) · idioma ${lang}`);
if (doTreino) {
  console.log(`AVISO:   relatório gerado DENTRO do treino — a tela tinha ${exemplos} EXEMPLO(S) na fila; a remontagem usa a fila REAL que o treino guardava, sem a faixa do treino.`);
}
console.log(`fila:    ${fila.length} pedido(s)${doTreino ? ' (a fila real que o treino guardava)' : ''}, injetando ${recorte.length} a partir do índice ${idx}`);
console.log(`filtros: ${JSON.stringify(st.filters || {})}`);

const { carregarPlaywright, abrirChromium } = await import('./navegador.mjs');
const { esperarOuExplodir } = await import('./esperar-saida.mjs');
const pw = await carregarPlaywright();

// Sobe por `tools/servidor-local.mjs`: a porta tem que estar LIVRE (a padrão é
// a mesma do smoke de layout, e com ele rodando a tela reconstruída seria a do
// servidor dele), e pronto é o próprio processo dizer que a ocupou.
const { servidor } = await subirServidorLocal({ porta: PORTA, variavel: '--porta' });
const parar = () => { try { servidor.kill(); } catch (e) {} };
process.on('SIGINT', () => { parar(); process.exit(130); });

const browser = await abrirChromium(pw, { headless: !args.includes('--abrir') });
const ctx = await browser.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: dpr,
  locale: lang, hasTouch: true, isMobile: true, serviceWorkers: 'block',
  // O esquema do APARELHO quando o relatório o traz; sem escolha guardada é
  // ele que o app segue — e aí `escuro` já veio dele (ou da tela).
  colorScheme: (tema.guardado && tema.sistema !== null ? tema.sistema : escuro) ? 'dark' : 'light',
});
// NADA sai pra rede, POR CONSTRUÇÃO: o estado vem do arquivo, e a sessão aqui
// é fictícia (ver abaixo). Antes isto valia só porque não havia token; com o
// token fictício, uma ação no replay iria à API local e voltaria 401, e o 401
// derrubaria a "sessão" da tela que se quer olhar. Abortada, a chamada é rede
// fora — o app segue na tela.
await ctx.route('**/api/**', (r) => r.abort('internetdisconnected'));
const page = await ctx.newPage();
const erros = [];
page.on('pageerror', (e) => erros.push(e.message));

// As preferências e o idioma entram ANTES da carga: o "Como funciona" da
// primeira execução cobre o card inteiro no Fold, e aí toda medição mede o
// modal. Custou uma rodada de mockups descobrir isso.
await page.addInitScript(([prefs, l, temaGuardado]) => {
  try {
    localStorage.setItem('waze_places_preferences', prefs);
    localStorage.setItem('waze_places_lang', l);
    // Só a escolha que a pessoa FEZ: sem ela, gravar "light" aqui fazia o app
    // parar de seguir o sistema — e o celular escuro remontava claro.
    if (temaGuardado) localStorage.setItem('waze_places_theme', temaGuardado);
  } catch (e) {}
}, [JSON.stringify({ ...(st.preferences || {}), comoFuncionaVisto: true }), lang, tema.guardado]);

await page.goto(`http://127.0.0.1:${PORTA}/`, { waitUntil: 'load' });
// Pelo lado do Node, não `waitForFunction`: o poller padrão dele avalia string
// DENTRO da página, e a CSP do app (sem `unsafe-eval`) o barra — o EvalError
// intermitente que custou rodadas de CI (ver `tools/esperar-saida.mjs`).
await esperarOuExplodir(page, () => typeof AppState !== 'undefined', 'o app carregar', 30000);

await page.evaluate(([places, filtros, perfil, devMode, placar]) => {
  for (const id of ['authScreen', 'loadingCard', 'comoFuncionaModal']) {
    document.getElementById(id)?.classList.add('hidden');
  }
  // A sessão é FICTÍCIA, e está no armazenamento como estaria no aparelho: sem
  // token, a sentinela `tokenNaoPersiste` acusava um defeito que o aparelho não
  // tinha (a tela logada sem token é artefato do replay). Gravado DEPOIS da
  // carga, pra o app não tentar entrar com ele.
  try { localStorage.setItem('waze_session_token', 'replay-sessao-ficticia'); } catch (e) {}
  AppState.profile = perfil || AppState.profile;
  if (filtros) AppState.filters = { ...AppState.filters, ...filtros };
  if (devMode) AppState.devMode = devMode;
  // O CABEÇALHO como o app o monta ao entrar — perfil, Filtros e Atualizar
  // (sem isto a remontagem saía com o cabeçalho de quem não entrou).
  showMainScreen();
  renderProfileHeader();
  AppState.queue = places;
  // O placar do APARELHO (ver `placarDoRelatorio`), não o do recorte injetado.
  AppState.stats = placar.stats;
  AppState.serverTotal = placar.serverTotal;
  AppState.hasMore = placar.hasMore;
  showCurrentPlace();
  updateStats(true);
  if (typeof atualizarFabDev === 'function') atualizarFabDev();
}, [recorte, st.filters || null, st.profile || null, st.devMode || null, placarDoRelatorio(st, recorte.length)]);

await page.waitForTimeout(500);

const visao = await page.evaluate(() => {
  const naTela = (id) => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden') && e.getBoundingClientRect().width > 0; };
  return {
    painel: document.querySelector('.place-card') ? 'card'
      : (!document.getElementById('noMoreCards')?.classList.contains('hidden') ? 'tudoLimpo' : 'nada'),
    titulo: document.querySelector('.card-name')?.textContent.trim() || null,
    tema: document.documentElement.classList.contains('dark') ? 'escuro' : 'claro',
    // O CABEÇALHO que ficou na tela — é a primeira coisa que difere quando a
    // remontagem não entra "como o app entra".
    cabecalho: { perfil: naTela('userProfileBadge') ? (document.getElementById('userName')?.textContent || '').trim() : null,
                 filtros: naTela('filtersBtn'), atualizar: naTela('refreshBtn') },
    // O PLACAR como a TELA o mostra (lido do DOM, não do AppState).
    placar: ['readCount', 'rejectedCount', 'skippedCount', 'pendingCount']
      .map((id) => (document.getElementById(id)?.textContent || '?').trim()),
    alertas: typeof diagSentinelas === 'function' ? diagSentinelas(diagComputado()) : null,
  };
});
console.log(`\npainel:  ${visao.painel}${visao.titulo ? ` · "${visao.titulo}"` : ''} · tema na tela ${visao.tema}`);
console.log(`cabeçalho: perfil ${visao.cabecalho.perfil ? `"${visao.cabecalho.perfil}"` : '—'} · Filtros ${visao.cabecalho.filtros ? 'sim' : 'NÃO'} · Atualizar ${visao.cabecalho.atualizar ? 'sim' : 'NÃO'}`);
console.log(`placar:  lidos ${visao.placar[0]} · rejeitados ${visao.placar[1]} · pulados ${visao.placar[2]} · restam ${visao.placar[3]}`);
if (visao.alertas) console.log(`alertas: ${visao.alertas.length ? JSON.stringify(visao.alertas) : 'nenhum'}`);
if (erros.length) console.log(`ERROS DE JS: ${erros.join(' | ')}`);

if (args.includes('--tela')) {
  const saida = ARQ.replace(/\.json$/, '') + '-replay.png';
  await page.screenshot({ path: saida });
  console.log(`\ntela salva em ${saida}`);
  await browser.close();
  parar();
} else {
  console.log(`\napp vivo em http://127.0.0.1:${PORTA}/ com o estado dele.`);
  console.log('Ctrl+C encerra (o servidor cai junto).');
  await new Promise(() => {});
}
