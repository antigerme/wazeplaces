// SMOKE DO "DISPONÍVEL OFFLINE" — ponta a ponta, no navegador, COM o service
// worker LIGADO.
//
// POR QUE ELE EXISTE, e o motivo é uma falha minha que chegou aos testadores:
// a v2026.09.21-08 subiu com DOIS defeitos que qualquer execução real teria
// pego, e nenhum teste pegou porque nenhum exercitava esta camada.
//
//  1. A varredura baixava tile com `fetch` cru. A CSP escolhe a diretiva pelo
//     DESTINO: `fetch` tem destino '' → `connect-src` (nominal, sem o host);
//     `<img>` tem destino 'image' → `img-src` (que permitia). Nenhum tile
//     entrou, e a linha travou em "Preparando… 197 de 530".
//  2. O service worker passou a interceptar o tile com `hit || fetch(...)`.
//     `respondWith` é PROMESSA DE RESPONDER: com o fetch barrado, a imagem
//     falhava — enquanto sem o SW o navegador a carregaria. O MAPA SUMIU PRA
//     TODO MUNDO, inclusive pra quem nunca ligou o offline.
//
// O smoke de layout tinha 47 contextos com `serviceWorkers: 'block'` e ZERO
// com 'allow'. Este arquivo é a camada que faltava: ele LIGA o service worker
// e exercita cada caminho do recurso contra a app de verdade.
//
// Regra que vale pra todo caso aqui: medir FATO, não intenção. Guard de fonte
// não enxerga CSP, não enxerga cache e não enxerga service worker.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as dormir } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.PORTA_OFFLINE || 8192);
const BASE = `http://127.0.0.1:${PORTA}`;

// ── browser ────────────────────────────────────────────────────────────────
let chromium = null;
const erros = [];
for (const tentar of [
  () => require.resolve('playwright', { paths: [ROOT] }),
  () => '/opt/node22/lib/node_modules/playwright/index.mjs',
  () => 'playwright',
]) {
  try { ({ chromium } = await import(tentar())); if (chromium) break; }
  catch (e) { erros.push(String(e.message || e).slice(0, 90)); }
}
if (!chromium) {
  console.error('playwright não encontrado:\n  - ' + erros.join('\n  - '));
  console.error('  No CI: npm i --no-save playwright@1.49.1 (com PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1)');
  process.exit(1);
}

// ── servidor ───────────────────────────────────────────────────────────────
// Chave FIXA: a seção da sala precisa assinar crachás iguais aos do servidor.
// Só de teste, e por isso é constante e óbvia.
const CHAVE_TESTE = Buffer.alloc(32, 7).toString('base64');
// A porta tem que estar LIVRE antes de eu subir. Checar depois é uma corrida
// que eu perco: o processo esquecido responde na hora, a sonda de saúde passa,
// e só então o meu `spawn` morre com EADDRINUSE — tarde demais, com o teste já
// medindo o servidor errado (foi assim que a seção da sala reprovou por vácuo,
// com TODO crachá voltando "inválido" porque a chave era de outro processo).
try {
  const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(1500) });
  if (r.ok) {
    console.error(`\n✗ a porta ${PORTA} já está ocupada por outro processo.`);
    console.error('  O teste mediria o servidor ERRADO — com outra chave, todo crachá seria recusado.');
    console.error('  Confira com: ps -eo pid,args | grep "[s]erver/node.mjs"');
    console.error(`  Ou rode noutra porta: PORTA_OFFLINE=8193 npm run test:offline`);
    process.exit(1);
  }
} catch (e) { /* ninguém atendeu: a porta está livre, que é o que eu quero */ }

const servidor = spawn(process.execPath, [join(ROOT, 'server', 'node.mjs')], {
  env: { ...process.env, PORT: String(PORTA), HOST: '127.0.0.1', ENCRYPTION_KEY: CHAVE_TESTE },
  stdio: ['ignore', 'ignore', 'inherit'],
});
process.on('exit', () => servidor.kill());

// O servidor que responde tem que ser O QUE EU SUBI.
//
// Sem esta checagem, um processo esquecido na mesma porta sequestra o teste em
// silêncio: o `spawn` morre com EADDRINUSE, a sonda de saúde passa (porque o
// processo VELHO responde), e o smoke mede um servidor com OUTRA chave. Foi o
// que aconteceu aqui — todo crachá voltava "inválido" e as invariantes da sala
// passavam por vácuo, porque ninguém conseguia entrar.
//
// É a mesma família dos outros erros de instrumento deste arquivo: o teste
// respondia sobre uma coisa diferente da que eu pensava estar medindo.
let morreuCedo = null;
servidor.on('exit', (code) => { morreuCedo = code; });
let vivo = false;
for (let i = 0; i < 60; i++) {
  if (morreuCedo !== null) break;
  try { const r = await fetch(BASE + '/'); if (r.ok) { vivo = true; break; } } catch (e) { /* subindo */ }
  await dormir(250);
}
if (morreuCedo !== null) {
  console.error(`\n✗ o servidor do teste morreu ao subir (código ${morreuCedo}).`);
  console.error(`  Quase sempre é a porta ${PORTA} ocupada por um processo esquecido.`);
  console.error('  Confira com: ps -eo pid,args | grep "[s]erver/node.mjs"');
  console.error('  Ou rode noutra porta: PORTA_OFFLINE=8193 npm run test:offline');
  process.exit(1);
}
if (!vivo) { console.error(`\n✗ o servidor não respondeu em ${BASE} depois de 15s.`); process.exit(1); }

// ── os casos ───────────────────────────────────────────────────────────────
const PX = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
const TILE = 'https://www.waze.com/row-tiles/live/base/17/50054/73871/tile.png';
let falhas = 0;
const diz = (n, cond, det = '') => {
  if (cond) console.log(`  ✓ ${n}`);
  else { console.log(`  ✗ ${n}${det ? '  — ' + det : ''}`); falhas++; }
};
const PLACE = (i, purType = 'NEW_PLACE') => ({
  venueID: 'v' + i, updateRequestID: 'u' + i, name: 'Local ' + i, categories: ['PARK'],
  address: 'Rua ' + i, updateType: 'Novo local', updateTypeKey: 'NEW_PLACE', purType,
  reqType: 'VENUE', createdBy: 'ed' + i, creatorId: 100 + i,
  imageUrls: ['https://venue-image.waze.com/thumbs/thumb700_f' + i],
  mapa: { centro: [-22.9 + i * 0.01, -43.2], entradas: [] },
  dateAdded: '2026-09-20T10:00:00Z', lat: -22.9, lon: -43.2,
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 },
  serviceWorkers: 'allow', locale: 'pt-BR', colorScheme: 'dark' });
let rotaTile = 0;
await ctx.route('**/*-tiles/live/base/**', (r) => { rotaTile++;
  return r.fulfill({ status: 200, contentType: 'image/png', body: PX,
    headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=600' } }); });
await ctx.route('**/venue-image.waze.com/**', (r) => r.fulfill({ status: 200,
  contentType: 'image/png', body: PX, headers: { 'cache-control': 'public, max-age=3600' } }));
const page = await ctx.newPage();
const errosJs = [];
const violacoes = [];
page.on('pageerror', (e) => errosJs.push(String(e.message).slice(0, 140)));
page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violacoes.push(m.text().slice(0, 140)); });

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
// sinal POSITIVO de que o SW assumiu — esperar por relógio mediria a máquina
await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller !== null,
  { timeout: 20000 }).catch(() => {});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof offlineVarrer === 'function', { timeout: 10000 }).catch(() => {});
const controlado = await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller));
diz('o service worker ASSUMIU (sem isto nada abaixo mede o que promete)', controlado);

const montar = (pls) => page.evaluate((ps) => {
  AppState.authenticated = true;
  AppState.preferences.comoFuncionaVisto = true;
  AppState.profile = { id: 1, userName: 'e', rank: 5, isAreaManager: true, isStaff: false };
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
  showLoading(false);
  AppState.queue = ps; AppState.currentPlace = ps[0]; AppState.serverTotal = ps.length;
  showCurrentPlace(); updatePendingCount();
}, pls);

console.log('\n── 1. O MAPA COM O TOGGLE DESLIGADO (o defeito que foi a produção) ──');
rotaTile = 0;
const semToggle = await page.evaluate((u) => new Promise((res) => { const i = new Image();
  i.onload = () => res('CARREGOU'); i.onerror = () => res('QUEBROU'); i.src = u; }), TILE);
diz('tile carrega normal com o SW ativo e o offline DESLIGADO', semToggle === 'CARREGOU' && rotaTile > 0,
  `${semToggle}, rota=${rotaTile}`);

console.log('\n── 2. A FILA SOBREVIVE (IndexedDB) ──');
await montar([PLACE(1), PLACE(2), PLACE(3)]);
const g = await page.evaluate(async () => {
  AppState.preferences.offlineDisponivel = true;
  const gravou = await offlineGravarFila();
  const lido = await offlineLerFila();
  return { gravou, n: lido && lido.places ? lido.places.length : 0, t: !!(lido && lido.t) };
});
diz('grava a fila e lê os 3 de volta, com carimbo de hora', g.gravou === true && g.n === 3 && g.t, JSON.stringify(g));
const recusa = await page.evaluate(async () => {
  AppState.preferences.offlineDisponivel = false;
  const r = await offlineGravarFila();
  AppState.preferences.offlineDisponivel = true; return r;
});
diz('com o toggle DESLIGADO não grava nada', recusa === false);

console.log('\n── 3. O SUFIXO DA FOTO É CONTRATO ──');
const suf = await page.evaluate(() => {
  offlineJanelaServida = 12345;
  const u = 'https://venue-image.waze.com/thumbs/thumb700_X';
  const com = urlDaFoto(u);
  AppState.preferences.offlineDisponivel = false;
  const sem = urlDaFoto(u);
  AppState.preferences.offlineDisponivel = true;
  return { com, sem };
});
diz('com o toggle ligado, a URL ganha o sufixo da janela SERVIDA', /\?w=12345$/.test(suf.com), suf.com);
diz('com ele desligado, a URL sai INTACTA (quem não marcou não paga)', !/\?w=/.test(suf.sem), suf.sem);
const doCard = await page.evaluate(async () => {
  offlineJanelaServida = 999;
  renderCurrentCard();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const i = document.querySelector('.place-card .card-image');
  return i ? i.getAttribute('src') : null;
});
diz('e o CARD usa exatamente a mesma URL (senão a foto some offline)', !!doCard && /\?w=999/.test(doCard),
  String(doCard).slice(-44));

console.log('\n── 4. A VARREDURA ENCHE, E O TILE VOLTA DO CACHE ──');
await page.evaluate(() => { offlineJanelaServida = null; offlineUltimoResultado = null; });
rotaTile = 0;
await page.evaluate(() => { offlineMarcarGesto(); return offlineVarrer(); });
await page.waitForFunction(() => offlineUltimoResultado !== null, { timeout: 25000, polling: 200 }).catch(() => {});
const varredura = await page.evaluate(async () => {
  const c = await caches.open('waze-places-tiles');
  return { n: (await c.keys()).length, res: offlineUltimoResultado, janela: offlineJanelaServida };
});
diz('a varredura PEDIU tiles (zero = a CSP está barrando)', rotaTile > 0, `rota=${rotaTile}`);
diz('guardou no cache e fechou PRONTA', varredura.n > 0 && varredura.res === 'pronto' && varredura.janela !== null,
  JSON.stringify(varredura));
// O tile tem que ser UM DOS QUE A VARREDURA GUARDOU — pedir um fixo inventado
// mede outra coisa: ele nunca esteve no cache, então voltar pela rede é o
// comportamento CERTO e a asserção reprovaria código bom (gotcha #28).
const guardado = await page.evaluate(async () => {
  const c = await caches.open('waze-places-tiles');
  const ks = await c.keys();
  return ks.length ? ks[0].url : null;
});
diz('a varredura deixou ao menos um tile identificável no cache', !!guardado, String(guardado));
let doCache = 'QUEBROU'; let rede = -1;
for (let i = 0; guardado && i < 25; i++) {
  rotaTile = 0;
  doCache = await page.evaluate((u) => new Promise((res) => { const im = new Image();
    im.onload = () => res('CARREGOU'); im.onerror = () => res('QUEBROU'); im.src = u; }), guardado);
  rede = rotaTile;
  if (doCache === 'CARREGOU' && rede === 0) break;
  await dormir(150);
}
diz('o tile guardado volta do CACHE, sem tocar a rede', doCache === 'CARREGOU' && rede === 0,
  `${doCache}, rede=${rede}`);

console.log('\n── 5. ABRIR SEM REDE ──');
await page.evaluate(() => offlineGravarFila());
await ctx.setOffline(true);
const off = await page.evaluate(async () => {
  AppState.queue = []; AppState.currentPlace = null; AppState.serverTotal = 0; AppState.loadError = true;
  const abriu = await offlineTentarAbrirSemRede();
  return { abriu, n: AppState.queue.length, erro: AppState.loadError };
});
diz('a fila guardada entra no lugar da tela de falha', off.abriu === true && off.n === 3 && off.erro === false,
  JSON.stringify(off));

console.log('\n── 6. O CARD QUE NÃO DÁ PRA DECIDIR ──');
await montar([PLACE(9, 'NEW_PHOTO')]);
const semFoto = await page.evaluate(async () => {
  const card = document.querySelector('.place-card:not(.card-fundo)') || document.querySelector('.place-card');
  // O `renderCurrentCard` JÁ chama o `marcarCardSemFoto` — chamar de novo
  // devolve `false` ("já marcado"), que é o comportamento certo. Quem responde
  // a pergunta é a TELA, não o retorno da minha chamada redundante.
  const aviso = card && card.querySelector('.card-sem-foto');
  const rej = card && card.querySelector('.card-btn-reject');
  const lido = card && card.querySelector('.card-btn-read');
  const pular = card && card.querySelector('.card-btn-skip');
  return { temAviso: !!aviso, texto: aviso ? aviso.textContent.slice(0, 40) : '',
    rejTravado: !!(rej && rej.disabled), lidoTravado: !!(lido && lido.disabled),
    pularVivo: !!(pular && !pular.disabled) };
});
diz('offline, o pedido de FOTO avisa que precisa de sinal — pelo render, sem ninguém chamar nada',
  semFoto.temAviso && /sinal/i.test(semFoto.texto), JSON.stringify(semFoto));
diz('✕ e ✓ ficam travados e o ↑ continua vivo', semFoto.rejTravado && semFoto.lidoTravado && semFoto.pularVivo,
  JSON.stringify(semFoto));
await ctx.setOffline(false);

console.log('\n── 7. ESQUECER PARA a varredura em voo (privacidade) ──');
// Enche, e ESQUECE no meio: o download já a caminho não pode pousar depois.
await page.evaluate(() => { offlineJanelaServida = null; offlineUltimoResultado = null;
  AppState.preferences.offlineDisponivel = true; offlineMarcarGesto(); offlineVarrer(); });
await dormir(60);
await page.evaluate(() => offlineEsquecer());
await dormir(900);
const depois = await page.evaluate(async () => {
  const c = await caches.open('waze-places-tiles');
  return { cache: (await c.keys()).length, fila: !!(await offlineLerFila()),
    janela: offlineJanelaServida, res: offlineUltimoResultado };
});
diz('depois de esquecer, o cache de tiles fica VAZIO', depois.cache === 0, JSON.stringify(depois));
diz('a fila guardada some e a janela zera', depois.fila === false && depois.janela === null, JSON.stringify(depois));

console.log('\n── 8. NADA DE ERRO, NADA DE CSP ──');
diz('nenhum erro de JS em todo o percurso', errosJs.length === 0, errosJs[0] || '');
diz('nenhuma violação de CSP', violacoes.length === 0, violacoes[0] || '');

await browser.close();
servidor.kill();
if (falhas) {
  console.log(`\n✗ smoke do offline: ${falhas} falha(s)`);
  process.exit(1);
}
console.log('\n✓ smoke do offline: 8 seções com o service worker LIGADO — mapa intacto com o'
  + ' toggle desligado, fila em IndexedDB, sufixo da foto como contrato (app E card),'
  + ' varredura enchendo e servindo do cache sem rede, abertura offline, card de foto'
  + ' travado com o ↑ vivo, e esquecer PARANDO o download em voo');
