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
// e exercita cada caminho do recurso contra o app de verdade.
//
// A ÚNICA exceção é a seção 6c: ela BLOQUEIA o service worker e não registra
// rota nenhuma, porque é o único jeito de medir a foto no cache HTTP do
// navegador — qualquer rota no contexto desliga esse cache (ver lá).
//
// Regra que vale pra todo caso aqui: medir FATO, não intenção. Guard de fonte
// não enxerga CSP, não enxerga cache e não enxerga service worker.

import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as dormir } from 'node:timers/promises';
import { esperarFimDaSaida, esperarNaPagina } from './esperar-saida.mjs';
import { lerDiagnostico } from './diag-ler.mjs';
import { carregarPlaywright, abrirChromium } from './navegador.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.PORTA_OFFLINE || 8192);
const BASE = `http://127.0.0.1:${PORTA}`;

// ── browser ────────────────────────────────────────────────────────────────
// Carregar e abrir passam pela fonte única (`tools/navegador.mjs`): ela exige
// o Playwright do REPO — o mesmo do CI, o mais novo — e diz no log qual
// navegador abriu.
const pw = await carregarPlaywright();

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
// Pedido SEM foto: aí o mapa é o PRIMEIRO slide e nasce visível. Com foto, quem
// abre é a foto e o `.card-map` nasce `hidden` — medir o mapa ali daria zero
// com o app certo, que é medir outra coisa (`mapaVemPrimeiro()` decide).
const SO_MAPA = (i) => ({ ...PLACE(i), imageUrls: [], imageUrl: null });
// Fotos REAIS do próprio servidor (mesma origem, logo permitidas pela CSP, e
// com `Cache-Control` de verdade), TRÊS arquivos diferentes: é o que deixa um
// teste distinguir QUAL foto chegou. As seções 6c e 7 usam.
const FOTOS_REAIS = ['/icons/splash/splash-750x1334-dark.png',
  '/icons/splash/splash-750x1334-light.png', '/icons/splash/splash-828x1792-light.png'];
const PLACE = (i, purType = 'NEW_PLACE') => ({
  venueID: 'v' + i, updateRequestID: 'u' + i, name: 'Local ' + i, categories: ['PARK'],
  address: 'Rua ' + i, updateType: 'Novo local', updateTypeKey: 'NEW_PLACE', purType,
  reqType: 'VENUE', createdBy: 'ed' + i, creatorId: 100 + i,
  imageUrls: ['https://venue-image.waze.com/thumbs/thumb700_f' + i],
  mapa: { centro: [-22.9 + i * 0.01, -43.2], entradas: [] },
  dateAdded: '2026-09-20T10:00:00Z', lat: -22.9, lon: -43.2,
});

const browser = await abrirChromium(pw);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 },
  serviceWorkers: 'allow', locale: 'pt-BR', colorScheme: 'dark' });
let rotaTile = 0;
// Handler NOMEADO de propósito: a contraprova da seção 1 precisa DESLIGAR o
// tile e religá-lo, e `unroute` sem a referência derruba tudo que casa com o
// padrão — inclusive o que as seções seguintes dependem.
let aviao = false;   // modo avião DE VERDADE é abort + setOffline (gotcha #28)
// `atrasoTile` deixa a varredura LENTA de propósito (seção 7d): sem ele ela
// termina em menos de um segundo e não há "meio" em que o sinal possa cair.
// Número (ms pra todo tile) ou função `(url) => ms`, quando a seção precisa
// que uns cheguem e outros não.
let atrasoTile = 0;
const servirTile = async (r) => {
  if (aviao) return r.abort('internetdisconnected');
  const espera = typeof atrasoTile === 'function' ? atrasoTile(r.request().url()) : atrasoTile;
  if (espera) { await dormir(espera); if (aviao) return r.abort('internetdisconnected'); }
  rotaTile++;
  return r.fulfill({ status: 200, contentType: 'image/png', body: PX,
    headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=600' } }); };
await ctx.route('**/*-tiles/live/base/**', servirTile);
// A foto do Waze respeita o modo avião como o tile: `setOffline` NÃO derruba
// requisição interceptada por `route.fulfill` (gotcha #28), então sem o abort a
// foto "carregava sem rede" e o card de foto nunca era posto à prova.
await ctx.route('**/venue-image.waze.com/**', (r) => aviao ? r.abort('internetdisconnected')
  : r.fulfill({ status: 200, contentType: 'image/png', body: PX, headers: { 'cache-control': 'public, max-age=3600' } }));
const page = await ctx.newPage();
// O erro capturado diz ONDE e vem INTEIRO. Sem isso, "erro de JS em algum
// lugar do percurso" é adivinhação — e foi o que me custou uma rodada de CI
// atrás de um `EvalError` que o app não podia produzir (ele não tem `eval`).
let secaoAtual = 'abertura';
const secao = (nome) => { secaoAtual = nome; console.log(`\n\u2500\u2500 ${nome} \u2500\u2500`); };
const errosJs = [];
const violacoes = [];
page.on('pageerror', (e) => errosJs.push({ secao: secaoAtual, txt: String(e.message) }));
// Falha de rede SEM sinal não pode virar erro no console: é o esperado, e o
// diário já tem a hora certa (`rede.caiu`). No relato de 2026-09-22 isso deu 16
// das 64 entradas do diário. Conta só durante o avião.
let errosDeRedeNoAviao = 0;
page.on('console', (m) => { if (aviao && m.type() === 'error' && /^Erro em /.test(m.text())) errosDeRedeNoAviao++; });
page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text()))
  violacoes.push({ secao: secaoAtual, txt: m.text() }); });

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
// sinal POSITIVO de que o SW assumiu — esperar por relógio mediria a máquina
await esperarNaPagina(page, () => !!(navigator.serviceWorker && navigator.serviceWorker.controller), 20000);
await page.reload({ waitUntil: 'domcontentloaded' });
await esperarNaPagina(page, () => typeof offlineVarrer === 'function', 10000);
const controlado = await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller));
diz('o service worker ASSUMIU (sem isto nada abaixo mede o que promete)', controlado);

const montarNa = (pg, pls) => pg.evaluate((ps) => {
  AppState.authenticated = true;
  AppState.preferences.comoFuncionaVisto = true;
  AppState.profile = { id: 1, userName: 'e', rank: 5, isAreaManager: true, isStaff: false };
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
  showLoading(false);
  AppState.queue = ps; AppState.currentPlace = ps[0]; AppState.serverTotal = ps.length;
  showCurrentPlace(); updatePendingCount();
}, pls);
const montar = (pls) => montarNa(page, pls);

secao('1. O MAPA COM O TOGGLE DESLIGADO (o defeito que foi a produção)');
// DUAS camadas, e a segunda é a única que responde ao relato do owner ("o mapa
// parou de carregar"). A primeira mede uma <img> SOLTA; a segunda mede o
// MAPINHA QUE O APP DESENHA — que é o que sumiu da tela de quem nunca ligou o
// offline. Medido na main de antes do conserto: 0 de 4 combinações desenhavam
// um tile sequer, com o instrumento acusando `imgs=0 rede=0`.
rotaTile = 0;
const semToggle = await page.evaluate((u) => new Promise((res) => { const i = new Image();
  i.onload = () => res('CARREGOU'); i.onerror = () => res('QUEBROU'); i.src = u; }), TILE);
diz('tile carrega normal com o SW ativo e o offline DESLIGADO', semToggle === 'CARREGOU' && rotaTile > 0,
  `${semToggle}, rota=${rotaTile}`);

const mapaDoCard = () => page.evaluate(async () => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const card = document.querySelector('#cardStack .place-card');
  const box = card && card.querySelector('.card-map');
  const im = box ? [...box.querySelectorAll('.card-map-tiles img')] : [];
  return { visivel: !!(box && !box.classList.contains('hidden')), n: im.length,
    ok: im.filter((i) => i.naturalWidth > 0).length };
});
await montar([SO_MAPA(1), SO_MAPA(2)]);
await dormir(1400);
const mCard = await mapaDoCard();
diz('o MAPINHA DO CARD desenha tile com o service worker no controle',
  mCard.visivel && mCard.n > 0 && mCard.ok === mCard.n, JSON.stringify(mCard));

// CONTRAPROVA — sem ela, "desenhou" passa por vácuo no dia em que o seletor
// mudar de nome ou o mapa deixar de montar: a medida devolveria 0 de 0 e a
// asserção acima, escrita com `ok === n`, aceitaria. Com o tile CAINDO, a
// mesma medida tem que ir a zero DESENHADO.
await ctx.unroute('**/*-tiles/live/base/**', servirTile);
await ctx.route('**/*-tiles/live/base/**', (r) => r.abort());
await montar([SO_MAPA(11), SO_MAPA(12)]);
await dormir(1400);
const mZero = await mapaDoCard();
diz('CONTRAPROVA: com o tile caindo, nenhum tile fica desenhado (o instrumento enxerga)',
  mZero.ok === 0, JSON.stringify(mZero));
await ctx.unroute('**/*-tiles/live/base/**');
await ctx.route('**/*-tiles/live/base/**', servirTile);

secao('1b. O MAPA AMPLIADO (o outro lugar em que o tile aparece)');
await montar([SO_MAPA(13), SO_MAPA(14)]);
await dormir(800);
const mAmp = await page.evaluate(async () => {
  MapaLightbox.open(AppState.currentPlace);
  await new Promise((r) => setTimeout(r, 1200));
  const cx = document.getElementById('mapaLbTiles');
  const im = cx ? [...cx.querySelectorAll('img')] : [];
  const aberto = MapaLightbox.isOpen();
  MapaLightbox.close();
  return { aberto, n: im.length, ok: im.filter((i) => i.naturalWidth > 0).length };
});
diz('o mapa AMPLIADO abre e desenha tile com o SW no controle',
  mAmp.aberto && mAmp.n > 0 && mAmp.ok === mAmp.n, JSON.stringify(mAmp));

secao('2. A FILA SOBREVIVE (IndexedDB)');
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

secao('3. O SUFIXO DA FOTO É CONTRATO');
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

secao('4. A VARREDURA ENCHE, E O TILE VOLTA DO CACHE');
await page.evaluate(() => { offlineJanelaServida = null; offlineUltimoResultado = null; });
rotaTile = 0;
await page.evaluate(() => { offlineMarcarGesto(); return offlineVarrer(); });
await esperarNaPagina(page, () => offlineUltimoResultado !== null, 25000);
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

// E o MAPA CONTINUA DESENHANDO com o cache cheio. Esta é a outra metade do
// defeito que foi à produção: lá o SW passou a interceptar o tile e a pagar com
// um `fetch` que a CSP dele barrava — `respondWith` é PROMESSA DE RESPONDER,
// então a imagem falhava onde sem o SW o navegador a teria carregado. Medir só
// "o cache serve" não pega isso: o caminho que quebrou é o do tile que NÃO está
// no cache, e com a varredura cheia ele continua existindo (outro card, outro
// enquadramento, outro zoom).
await montar([SO_MAPA(21), SO_MAPA(22)]);
await dormir(1400);
const mCheio = await mapaDoCard();
diz('com o cache CHEIO, o mapinha do card segue desenhando (tile fora do cache não pode quebrar)',
  mCheio.visivel && mCheio.n > 0 && mCheio.ok === mCheio.n, JSON.stringify(mCheio));

secao('5. ABRIR SEM REDE');
// Remonta os 3 ANTES de gravar: as seções do mapa trocam a fila, e sem isto a
// asserção mediria o tamanho da última montagem em vez do que ela promete.
await montar([PLACE(1), PLACE(2), PLACE(3)]);
await page.evaluate(() => offlineGravarFila());
await ctx.setOffline(true);
const off = await page.evaluate(async () => {
  AppState.queue = []; AppState.currentPlace = null; AppState.serverTotal = 0; AppState.loadError = true;
  const abriu = await offlineTentarAbrirSemRede();
  return { abriu, n: AppState.queue.length, erro: AppState.loadError };
});
diz('a fila guardada entra no lugar da tela de falha', off.abriu === true && off.n === 3 && off.erro === false,
  JSON.stringify(off));

secao('5b. FECHAR E REABRIR SEM REDE — a página NOVA, o app de verdade decidindo');
// O relato de 2026-09-22: "ativei o modo offline, baixou tudo, fechei a
// aplicação e ao reabrir não carrega nada". O diagnóstico dele mostrou a fila
// guardada ENTRANDO (236, `offline.abriu`), o card montado e o mapa vindo do
// cache — por BAIXO do esqueleto de "carregando", que nasce visível (z-50) e
// que só o `startFetching` escondia.
//
// A seção 5 não podia ver isso, e o motivo é o instrumento: ela chama
// `offlineTentarAbrirSemRede()` numa página JÁ VIVA, com o esqueleto já
// escondido, e confere o `AppState`. E o `montarNa` desta casa faz
// `showLoading(false)` por conta própria — ou seja, o helper fazia exatamente o
// que o app esquecia. Aqui ninguém ajuda: token, preferências e fila vão pro
// ARMAZENAMENTO, e uma página NOVA abre sem rede com o `initApp` de verdade.
// E o que se mede é o que o DEDO alcança (`elementFromPoint`, gotcha #26), não
// se o card existe no DOM — ele existia no relato.
aviao = false; await ctx.setOffline(false);
await montar([SO_MAPA(81), SO_MAPA(82), SO_MAPA(83)]);
await page.evaluate(() => {
  AppState.preferences.offlineDisponivel = true;
  AppState.preferences.comoFuncionaVisto = true;
  savePreferences();
  API.setSession('tok-reabrir');
  offlineJanelaServida = null; offlineUltimoResultado = null; offlineMarcarGesto(); offlineVarrer();
});
await esperarNaPagina(page, () => offlineUltimoResultado !== null, 60000, 250);
const encheu5b = await page.evaluate(() => offlineUltimoResultado);
diz('PRÉ-CONDIÇÃO: com rede, a preparação ENCHEU antes de fechar o app', encheu5b === 'pronto', String(encheu5b));
aviao = true; await ctx.setOffline(true);
const cdpReabrir = await ctx.newCDPSession(page);
let estadosReabrir = [];
cdpReabrir.on('ServiceWorker.workerVersionUpdated', (e) => { estadosReabrir = e.versions.map((v) => v.runningStatus); });
await cdpReabrir.send('ServiceWorker.enable');
for (const variante of [
  { nome: 'worker VIVO (o caso do relato)', parar: false },
  { nome: 'worker ENCERRADO (o app fechado por mais de ~30s)', parar: true },
]) {
  if (variante.parar) {
    estadosReabrir = [];
    await cdpReabrir.send('ServiceWorker.stopAllWorkers');
    for (let i = 0; i < 30 && !estadosReabrir.includes('stopped'); i++) await dormir(100);
    diz(`${variante.nome}: CONTROLE — o worker foi de fato ENCERRADO antes de reabrir`,
      estadosReabrir.includes('stopped'), JSON.stringify(estadosReabrir));
  }
  const fria = await ctx.newPage();
  fria.on('pageerror', (e) => errosJs.push({ secao: secaoAtual + ' [reaberta]', txt: String(e.message) }));
  fria.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text()))
    violacoes.push({ secao: secaoAtual + ' [reaberta]', txt: m.text() }); });
  let m = null;
  try {
    await fria.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    // Sinal POSITIVO: o app DIZ que abriu a fila guardada; e depois o mapa do
    // card da frente termina de tentar (do cache, que é o que se espera).
    await esperarNaPagina(fria, () => typeof dfatoAnel !== 'undefined'
      && dfatoAnel.some((e) => e.k === 'offline.abriu'), 20000, 100);
    await esperarNaPagina(fria, () => { const f = typeof cardDaFrente === 'function' && cardDaFrente();
      return !!f && [...f.querySelectorAll('.card-map-tiles img')].every((x) => x.complete); }, 8000, 100);
    await dormir(300);
    m = await fria.evaluate(() => {
      const esq = document.getElementById('loadingCard');
      const frente = cardDaFrente();
      const onde = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const alvo = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!alvo) return null;
        if (frente && frente.contains(alvo)) return 'card';
        if (esq && esq.contains(alvo)) return 'esqueleto';
        return String(alvo.id || alvo.className || alvo.tagName).slice(0, 40);
      };
      const tl = frente ? [...frente.querySelectorAll('.card-map-tiles img')] : [];
      const medir = () => ({ esqueletoOculto: !!esq && esq.classList.contains('hidden'),
        painel: dlogTelaAtual().painel, dedoNoX: onde(frente && frente.querySelector('.card-btn-reject')),
        dedoNoCartao: onde(frente && frente.querySelector('.card-name')),
        alertas: diagSentinelas(diagComputado()).map((a) => a.chave) });
      const agora = medir();
      // A linha do tempo que o diário conta da ABERTURA — lida ANTES do
      // controle, que recoloca e tira o esqueleto (e anota as duas coisas).
      const linhaDoTempo = dfatoAnel.filter((e) => /^tela\.(carregando|primeiroCard)$|^offline\.abriu$/.test(e.k))
        .map((e) => ({ k: e.k, visivel: e.visivel, naAbertura: e.naAbertura }));
      const resumoCap = (c) => c && { painel: c.painel, cardMontado: c.cardMontado,
        alertas: (c.alertas || []).map((a) => a.chave) };
      // A captura pelo botão, no estado são: nada a acusar, e o card montado.
      const capSa = resumoCap(dlogCapturar('manual'));
      // CONTROLE do instrumento: o esqueleto de volta POR CIMA do card tem que
      // ser VISTO pelo dedo e pela sentinela — senão "o dedo cai no card"
      // passaria por vácuo no dia em que o esqueleto mudar de camada. E a
      // captura feita AGORA tem que acusar no instante: é o toque no botão com
      // o defeito na tela, que o relatório (gerado depois) não vê.
      showLoading(true);
      const comEsqueleto = medir();
      const capEsq = resumoCap(dlogCapturar('manual'));
      showLoading(false);
      return { onLine: navigator.onLine, fila: AppState.queue.length,
        caiuNaAbertura: dfatoAnel.some((e) => e.k === 'rede.caiu' && e.naAbertura),
        tiles: { pedidos: tl.length, ok: tl.filter((x) => x.naturalWidth > 0).length },
        linhaDoTempo, capSa, capEsq,
        ...agora, controle: comEsqueleto };
    });
  } catch (e) {
    m = { erro: String((e && e.message) || e).slice(0, 200) };
  }
  // O RELATÓRIO de verdade desta página, e o LEITOR rodando nele — uma vez só
  // (na primeira variante): o alerta da captura tem que chegar ao resumo do
  // arquivo, e a triagem tem que mostrá-lo sem o token da sessão. É o caminho
  // inteiro do relato: toque no botão com o defeito na tela, arquivo gerado
  // depois, e a leitura.
  let relReaberto = null;
  if (!variante.parar && m && !m.erro) {
    const dirR = mkdtempSync(join(tmpdir(), 'diag-reaberta-'));
    try {
      const [dl] = await Promise.all([
        fria.waitForEvent('download', { timeout: 30000 }),
        fria.evaluate(() => baixarDiagnostico()),
      ]);
      const arq = join(dirR, 'diag.zip');
      await dl.saveAs(arq);
      const { dados: d } = lerDiagnostico(arq);
      const triagem = execFileSync(process.execPath, [join(ROOT, 'tools/diag-resumo.mjs'), arq],
        { encoding: 'utf8', timeout: 20000 });
      relReaberto = { v: d._versaoDoDiag, nasCapturas: d.resumo?.alertasNasCapturas,
        triagemAcusa: /nas capturas: .*→ .*esqueletoSobreCard/.test(triagem),
        vazouToken: triagem.includes('tok-reabrir') };
    } catch (e) {
      relReaberto = { erro: String((e && e.message) || e).slice(0, 200) };
    } finally {
      rmSync(dirR, { recursive: true, force: true });
    }
  }
  await fria.close();
  diz(`${variante.nome}: PRÉ-CONDIÇÃO — a página NOVA nasceu sem rede e a fila guardada entrou`,
    m?.onLine === false && m?.caiuNaAbertura === true && m?.fila === 3, JSON.stringify(m));
  diz(`${variante.nome}: o esqueleto SAIU — o que se vê é o card`,
    m?.esqueletoOculto === true && m?.painel === 'card', JSON.stringify(m));
  diz(`${variante.nome}: o dedo no ✕ e no nome cai NO CARD, não no esqueleto`,
    m?.dedoNoX === 'card' && m?.dedoNoCartao === 'card', JSON.stringify(m));
  diz(`${variante.nome}: o mapa do card veio do cache, sem rede`,
    m?.tiles?.pedidos > 0 && m?.tiles?.ok === m?.tiles?.pedidos, JSON.stringify(m?.tiles));
  diz(`${variante.nome}: e o relatório não acusa esqueleto por cima de card`,
    Array.isArray(m?.alertas) && !m.alertas.includes('esqueletoSobreCard'), JSON.stringify(m?.alertas));
  diz(`${variante.nome}: CONTROLE — com o esqueleto de volta por cima, o dedo o acerta e a sentinela acusa`,
    m?.controle?.dedoNoX === 'esqueleto' && m?.controle?.alertas?.includes('esqueletoSobreCard'),
    JSON.stringify(m?.controle));
  // O DIÁRIO conta a abertura sozinho: esqueleto desde o início, o primeiro
  // card, e o esqueleto SAINDO — no relato, a última linha nunca veio.
  const lt = m?.linhaDoTempo || [];
  const iSai = lt.findIndex((e) => e.k === 'tela.carregando' && e.visivel === false);
  diz(`${variante.nome}: o diário conta a abertura — carregando desde o início, o primeiro card, e o carregando SAINDO`,
    lt[0]?.k === 'tela.carregando' && lt[0]?.visivel === true && lt[0]?.naAbertura === true
    && lt.some((e) => e.k === 'tela.primeiroCard') && iSai > 0, JSON.stringify(lt));
  diz(`${variante.nome}: a captura no estado são não acusa esqueleto, e diz que o card está montado`,
    m?.capSa?.painel === 'card' && m?.capSa?.cardMontado === true
    && Array.isArray(m?.capSa?.alertas) && !m.capSa.alertas.includes('esqueletoSobreCard'), JSON.stringify(m?.capSa));
  diz(`${variante.nome}: CONTROLE — a captura com o esqueleto por cima ACUSA no instante`,
    m?.capEsq?.painel === 'carregando' && m?.capEsq?.cardMontado === true
    && m?.capEsq?.alertas?.includes('esqueletoSobreCard'), JSON.stringify(m?.capEsq));
  if (!variante.parar) {
    const nc = relReaberto?.nasCapturas;
    diz(`${variante.nome}: o RELATÓRIO de verdade leva o alerta DA CAPTURA no resumo, e o leitor o mostra sem o token`,
      relReaberto?.v >= 4 && Array.isArray(nc)
      && nc.some((c) => c.painel === 'carregando' && c.alertas.includes('esqueletoSobreCard'))
      && !nc.some((c) => c.painel === 'card' && c.alertas.includes('esqueletoSobreCard'))
      && relReaberto.triagemAcusa === true && relReaberto.vazouToken === false,
      JSON.stringify(relReaberto));
  }
}
// Volta ao estado em que a seção 5 deixou: sem rede, sem sessão, `aviao` a cargo da 6.
await page.evaluate(() => { API.setSession(null); });
aviao = false;

secao('6. O CARD DE FOTO SEM REDE: a foto que VEIO aparece, a que NÃO VEIO avisa');
// ESTA SEÇÃO EXIGIA O DEFEITO COMO CORRETO. Ela montava um card de FOTO sem rede
// e cobrava o aviso "precisa de sinal" — sem nunca perguntar se a foto estava
// guardada. O app, igual: o aviso nascia por SUPOSIÇÃO (`offline` + tipo de foto)
// e escondia a foto que a varredura tinha acabado de guardar pra este momento.
// RELATADO pelo owner no Android, com a varredura em "Pronto" 1 minuto antes: os
// três cards de "Nova foto" vieram vazios. E o diagnóstico dele PROVA que o
// cache funcionou: as três fotos estão `quebrada: false`, com o sufixo certo,
// em momentos capturados SEM REDE — o app só as escondia.
//
// Os DOIS lados são medidos, e por sinal POSITIVO de cada desfecho (gotcha #62):
//   · a foto NÃO chega  → aviso, ✕ e ✓ travados, ↑ vivo;
//   · a foto CHEGA      → ela aparece, sem aviso, com ✕ vivo.
// LIMITE DO INSTRUMENTO, dito aqui e não escondido: a foto real é de OUTRA
// origem e sai do cache HTTP do navegador. Este sandbox intercepta TLS por nome
// de host e ignora `--host-resolver-rules` (medido: o mapeamento pra um servidor
// local devolve o 403 do bucket real), então não dá pra servir
// `venue-image.waze.com` daqui. O que esta seção trava é a LÓGICA — carregou,
// aparece; falhou, avisa —, e o caminho do cache ficou provado no aparelho.
aviao = true;
const lerFotoDoCard = () => page.evaluate(() => {
  const card = document.querySelector('#cardStack .place-card:not(.card-fundo)');
  const img = card && card.querySelector('.card-image');
  const aviso = card && card.querySelector('.card-sem-foto');
  const rej = card && card.querySelector('.card-btn-reject');
  const lido = card && card.querySelector('.card-btn-read');
  const pular = card && card.querySelector('.card-btn-skip');
  return { temAviso: !!aviso, texto: aviso ? aviso.textContent.slice(0, 40) : '',
    fotoVisivel: !!(img && !img.classList.contains('hidden') && img.naturalWidth > 0),
    rejTravado: !!(rej && rej.disabled), lidoTravado: !!(lido && lido.disabled),
    pularVivo: !!(pular && !pular.disabled) };
});
// 6a) a foto NÃO chega (a do Waze, abortada no avião)
await montar([PLACE(9, 'NEW_PHOTO')]);
await esperarNaPagina(page, () => !!document.querySelector('#cardStack .place-card:not(.card-fundo) .card-sem-foto'), 8000);
const semFoto = await lerFotoDoCard();
diz('a foto NÃO chegou: o card avisa que precisa de sinal', semFoto.temAviso && /sinal/i.test(semFoto.texto),
  JSON.stringify(semFoto));
diz('e trava ✕ e ✓, com o ↑ vivo', semFoto.rejTravado && semFoto.lidoTravado && semFoto.pularVivo,
  JSON.stringify(semFoto));
// A trava tem que SOBREVIVER à ação anterior terminar. `aplicarTravaDeAcao` roda
// a cada ação que começa, termina ou é desfeita, e escrevia `disabled` nos três
// botões sem saber do aviso — reabrindo ✕ e ✓ num card sem foto. Foi como a
// estrada, rodando contra a main de antes, mostrou aviso na tela e ✕ vivo.
await page.evaluate(() => aplicarTravaDeAcao());
const depoisDaAcao = await lerFotoDoCard();
diz('e a trava SOBREVIVE à ação anterior terminar (✕ e ✓ seguem travados, ↑ vivo)',
  depoisDaAcao.temAviso && depoisDaAcao.rejTravado && depoisDaAcao.lidoTravado && depoisDaAcao.pularVivo,
  JSON.stringify(depoisDaAcao));
// O aviso nascido da falha de VERDADE é o comportamento certo: a sentinela cala.
const sentFalhou = await page.evaluate(() => diagSentinelas(diagComputado()).map((a) => a.chave));
diz('com a foto que FALHOU de verdade, o aviso é o certo — a sentinela da foto cala',
  !sentFalhou.includes('fotoEscondidaComAviso'), JSON.stringify(sentFalhou));
// 6b) a foto CHEGA — o defeito que chegou aos testadores
//
// A foto que "chega" sem rede é a que foi AQUECIDA com rede — é o que a varredura
// faz de verdade. Até o Playwright 1.56 esta seção passava SEM aquecer, por um
// buraco do instrumento: o `setOffline` não alcançava o `fetch` de DENTRO do
// service worker, e a foto de mesma origem ia buscar na rede em pleno "modo
// avião". MEDIDO com controle, mesmo app, a foto nunca pedida: 1.56.1 (Chromium
// 141) CARREGA sem rede; 1.63.0 (Chrome 153) QUEBRA — como num celular de
// verdade —, e a já aquecida carrega nas duas. Sem aquecer, a seção passou a
// medir uma foto que nunca veio, e cobrava dela o comportamento da que veio.
// Aquece a MESMA URL que o card vai pedir (`urlDaFoto`, com o sufixo do offline).
const FOTO_QUE_CHEGA = BASE + '/icons/screenshots/previa-card.jpg';
aviao = false; await ctx.setOffline(false);
const fotoAquecida = await page.evaluate((u) => new Promise((res) => { const i = new Image();
  i.onload = () => res(true); i.onerror = () => res(false); i.src = urlDaFoto(u); }), FOTO_QUE_CHEGA);
aviao = true; await ctx.setOffline(true);
diz('PRÉ-CONDIÇÃO: a foto que vai chegar foi aquecida COM rede', fotoAquecida);
await montar([{ ...PLACE(10, 'NEW_PHOTO'), imageUrls: [FOTO_QUE_CHEGA] }]);
await esperarNaPagina(page, () => { const i = document.querySelector('#cardStack .place-card:not(.card-fundo) .card-image');
  return !!(i && i.naturalWidth > 0); }, 8000);
await dormir(400);   // folga pra um aviso tardio aparecer, se o defeito voltar
const comFotoCard = await lerFotoDoCard();
diz('a foto CHEGOU: ela aparece no card de foto, sem aviso', comFotoCard.fotoVisivel && !comFotoCard.temAviso,
  JSON.stringify(comFotoCard));
diz('e o ✕ fica vivo — há foto pra decidir', !comFotoCard.rejTravado && !comFotoCard.lidoTravado,
  JSON.stringify(comFotoCard));
// 6d) A SENTINELA do aviso, com o defeito ENCENADO. Com o conserto o aviso só
// nasce da FALHA da foto — então aviso por cima de foto carregada é exatamente
// o defeito do relato, e o relatório dele ficou mudo com isso na tela.
const sentFoto = await page.evaluate(() => {
  const chaves = () => diagSentinelas(diagComputado()).map((a) => a.chave);
  const certo = chaves();
  marcarCardSemFoto(cardDaFrente(), AppState.currentPlace);
  return { certo, defeito: chaves(), aviso: !!cardDaFrente().querySelector('.card-sem-foto') };
});
diz('CONTROLE: foto carregada e sem aviso — a sentinela da foto cala',
  !sentFoto.certo.includes('fotoEscondidaComAviso'), JSON.stringify(sentFoto));
diz('aviso por cima de foto CARREGADA (o defeito do relato, encenado) — a sentinela acusa',
  sentFoto.aviso && sentFoto.defeito.includes('fotoEscondidaComAviso'), JSON.stringify(sentFoto));
// 6e) A REDE VOLTA e o card "sem foto" SE RECUPERA. O aviso promete "Ela chega
// sozinha quando a rede voltar", e nada buscava a foto de novo: o card ficava
// travado até a pessoa pular (auditoria de 2026-09-25). Os DOIS tempos da rede
// são medidos, porque o `online` chega antes do sinal: redesenhar ali daria
// "Sem Imagem" com ✕ e ✓ VIVOS — decidir foto não vista.
const pedidosDaFoto11 = [];
const contarFoto11 = (r) => { if (r.url().indexOf('thumb700_f11') !== -1) pedidosDaFoto11.push(r.url()); };
page.on('request', contarFoto11);
await montar([PLACE(11, 'NEW_PHOTO')]);
await esperarNaPagina(page, () => !!document.querySelector('#cardStack .place-card:not(.card-fundo) .card-sem-foto'), 8000);
const antesDeVoltar = await lerFotoDoCard();
diz('PRÉ-CONDIÇÃO: sem rede, a foto não vem e o card avisa, com ✕ e ✓ travados',
  antesDeVoltar.temAviso && antesDeVoltar.rejTravado && antesDeVoltar.lidoTravado, JSON.stringify(antesDeVoltar));
// 1º tempo: o navegador diz "online", mas a foto ainda não passa (o avião segue na rota).
const pedidosAntes = pedidosDaFoto11.length;
await ctx.setOffline(false);
await esperarNaPagina(page, () => navigator.onLine === true, 5000);
await dormir(1500);
const primeiroTempo = await lerFotoDoCard();
diz('CONTROLE: a volta da rede FOI percebida — a foto foi pedida de novo', pedidosDaFoto11.length > pedidosAntes,
  `${pedidosAntes} → ${pedidosDaFoto11.length}`);
diz('rede FIRMANDO (online sem sinal): o card segue avisando, com ✕ e ✓ travados — nada de "Sem Imagem" com botão vivo',
  primeiroTempo.temAviso && primeiroTempo.rejTravado && primeiroTempo.lidoTravado, JSON.stringify(primeiroTempo));
// 2º tempo: o sinal firma e o navegador avisa de novo.
aviao = false;
await ctx.setOffline(true);
await ctx.setOffline(false);
await esperarNaPagina(page, () => { const c = document.querySelector('#cardStack .place-card:not(.card-fundo)');
  const i = c && c.querySelector('.card-image');
  return !!(c && !c.querySelector('.card-sem-foto') && i && i.naturalWidth > 0); }, 10000);
const voltou = await lerFotoDoCard();
diz('a rede VOLTOU: o card sai do aviso e mostra a foto, sem ninguém tocar em nada',
  voltou.fotoVisivel && !voltou.temAviso, JSON.stringify(voltou));
diz('e o ✕ e o ✓ destravam — agora há foto pra decidir', !voltou.rejTravado && !voltou.lidoTravado,
  JSON.stringify(voltou));
page.off('request', contarFoto11);
aviao = false;
await ctx.setOffline(false);

secao('6c. A FOTO GUARDADA É A FOTO EM DECISÃO — e o app REABERTO sem rede a encontra');
// DOIS defeitos, e os dois só aparecem no card de FOTO SEM REDE:
//  1. A varredura guardava `imageUrls[0]`, e o card de foto abre na foto EM
//     DECISÃO (a proposta ou a denunciada). MEDIDO na fila do owner: em 13 de
//     76 pedidos de foto ela NÃO é a primeira — o card abria na que ninguém
//     guardou, com "a foto precisa de sinal" e ✕/✓ travados.
//  2. A janela do sufixo (`?w=`) morava só em memória. O app REABERTO sem rede
//     (o Android encerra o app em segundo plano) nascia com ela nula, pedia a
//     foto CRUA — e a crua ninguém guardou.
//
// UM CONTEXTO À PARTE, com o service worker BLOQUEADO, e é isso que o torna
// fiel: a foto do Waze é de OUTRA origem, o SW a ignora e ela vive no cache
// HTTP do navegador. Aqui a foto é do próprio servidor (a CSP só admite
// `'self'` e o Waze, e este sandbox não serve `venue-image.waze.com`), e com o
// SW ligado ela passaria pelo cache DELE, que o modo avião do Playwright nem
// alcança. Com o SW fora, o caminho é o do aparelho: `<img>` → cache HTTP, e
// o avião derruba o que não estiver guardado.
//
// E SEM NENHUM `route` — nem o do tile. QUALQUER rota registrada no contexto
// DESLIGA o cache HTTP do navegador (o Playwright o desativa ao ligar a
// interceptação). MEDIDO com controle, mesma foto, mesmo servidor: sem rota
// ela volta do cache no avião; com uma rota que nem casa com ela, QUEBRA. É por
// isso que nenhuma outra seção deste arquivo consegue medir a foto offline — o
// contexto principal tem rotas —, e por isso os pedidos daqui vêm sem mapa: sem
// tile, a varredura fecha pronta sem precisar da rota.
//
// A fixture DISTINGUE os casos (pergunta 2 do CLAUDE.md): a foto em decisão é
// a 2ª num pedido e a 3ª no outro, cada foto um arquivo diferente, e os dois
// ficam atrás de 4 cards SEM foto — nada foi pintado nem pré-carregado CRU
// antes da varredura, então o que abrir sem rede só pode ter vindo dela. O
// CONTROLE disso é medido, não suposto (a primeira asserção de rede abaixo).
const ctxFoto = await browser.newContext({ viewport: { width: 390, height: 844 },
  serviceWorkers: 'block', locale: 'pt-BR', colorScheme: 'dark' });
const pgFoto = await ctxFoto.newPage();
pgFoto.on('pageerror', (e) => errosJs.push({ secao: secaoAtual, txt: String(e.message) }));
pgFoto.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text()))
  violacoes.push({ secao: secaoAtual, txt: m.text() }); });
// O que a PÁGINA pediu ao servidor. É a medida de rede: com o SW bloqueado,
// todo pedido de foto aparece aqui, e o sufixo diz quem o fez.
const fotosPedidas = [];
pgFoto.on('request', (r) => { if (r.url().indexOf('/icons/splash/') !== -1) fotosPedidas.push(r.url().slice(BASE.length)); });
await pgFoto.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await esperarNaPagina(pgFoto, () => typeof offlineVarrer === 'function', 10000);
const arquivo = (k) => FOTOS_REAIS[k].split('/').pop().replace('.png', '');
// O vínculo com a foto em decisão é o ID dentro da URL — `updateRequestID` na
// foto proposta, `flagEntityID` na denunciada —, como no Waze.
const FOTO_NA_2A = { ...PLACE(61, 'NEW_PHOTO'), mapa: null, updateRequestID: arquivo(1),
  imageUrls: [BASE + FOTOS_REAIS[0], BASE + FOTOS_REAIS[1]] };
const DENUNCIA_NA_3A = { ...PLACE(62, 'FLAGGED_PHOTO'), mapa: null, flagEntityID: arquivo(2), flagSubjectType: 'IMAGE',
  imageUrls: [BASE + FOTOS_REAIS[0], BASE + FOTOS_REAIS[1], BASE + FOTOS_REAIS[2]] };
const VAZIO = (i) => ({ ...PLACE(i), imageUrls: [], imageUrl: null, mapa: null });
const FILA_6C = [VAZIO(51), VAZIO(52), VAZIO(53), VAZIO(54), FOTO_NA_2A, DENUNCIA_NA_3A];
await pgFoto.evaluate(() => { AppState.preferences.offlineDisponivel = true; });
await montarNa(pgFoto, FILA_6C);
await dormir(1500);   // o aquecimento do próximo card é AGENDADO: deixa ele sair antes da foto
const cruasAntes = fotosPedidas.filter((u) => u.indexOf('?w=') === -1);
diz('CONTROLE: nenhuma foto foi pedida CRUA antes da varredura (o que abrir sem rede veio dela)',
  cruasAntes.length === 0, JSON.stringify(cruasAntes));
await pgFoto.evaluate(() => { offlineJanelaServida = null; offlineUltimoResultado = null;
  offlineMarcarGesto(); return offlineVarrer(); });
await esperarNaPagina(pgFoto, () => offlineUltimoResultado !== null, 60000, 250);
const enc6c = await pgFoto.evaluate(() => ({ res: offlineUltimoResultado, janela: offlineJanelaServida }));
diz('a varredura fechou PRONTA', enc6c.res === 'pronto' && enc6c.janela !== null, JSON.stringify(enc6c));
const sufixo = '?w=' + enc6c.janela;
const emDecisao = [FOTOS_REAIS[1] + sufixo, FOTOS_REAIS[2] + sufixo];
diz('a varredura guardou a foto EM DECISÃO de cada pedido de foto (a 2ª e a 3ª da lista)',
  emDecisao.every((u) => fotosPedidas.includes(u)), JSON.stringify(fotosPedidas));
diz('e NÃO a primeira da lista, que nenhum dos dois cards mostra',
  !fotosPedidas.includes(FOTOS_REAIS[0] + sufixo), JSON.stringify(fotosPedidas));

// CONTROLE DO INSTRUMENTO nos dois sentidos, antes de medir o app: sem rede,
// uma foto que JÁ veio tem que abrir do cache HTTP, e uma que NUNCA foi pedida
// tem que quebrar. Sem o primeiro, "abriu" poderia ser rede vazando; sem o
// segundo, a medida não distinguiria guardado de não guardado.
const imgSolta = (u) => pgFoto.evaluate((u) => new Promise((res) => { const i = new Image();
  i.onload = () => res('CARREGOU'); i.onerror = () => res('QUEBROU'); i.src = u; }), u);
const jaVeio = BASE + FOTOS_REAIS[0] + '?controle=1';
await imgSolta(jaVeio);
aviao = true; await ctxFoto.setOffline(true);
const ctrlVeio = await imgSolta(jaVeio);
const ctrlNunca = await imgSolta(BASE + FOTOS_REAIS[0] + '?controle=nunca');
diz('CONTROLE: sem rede, a foto que já veio abre do cache e a nunca pedida quebra',
  ctrlVeio === 'CARREGOU' && ctrlNunca === 'QUEBROU', `${ctrlVeio} / ${ctrlNunca}`);
const lerFotoEm = (pg) => pg.evaluate(() => {
  const card = document.querySelector('#cardStack .place-card:not(.card-fundo)');
  const img = card && card.querySelector('.card-image');
  const rej = card && card.querySelector('.card-btn-reject');
  return { src: img ? String(img.getAttribute('src') || '').replace(location.origin, '') : '',
    fotoVisivel: !!(img && !img.classList.contains('hidden') && img.naturalWidth > 0),
    temAviso: !!(card && card.querySelector('.card-sem-foto')), rejVivo: !!(rej && !rej.disabled) };
});
// Espera a foto DECIDIR — carregou ou caiu no aviso —, pelo lado do Node e por
// sinal POSITIVO dos dois desfechos (gotcha #62). Prazo fixo mediria o runner.
const fotoDecidiu = () => {
  const card = document.querySelector('#cardStack .place-card:not(.card-fundo)');
  const img = card && card.querySelector('.card-image');
  return !!(card && (card.querySelector('.card-sem-foto') || (img && img.complete && img.naturalWidth > 0)));
};
const conferirCardDeFoto = async (rotulo, arquivoEsperado) => {
  await esperarNaPagina(pgFoto, fotoDecidiu, 8000);
  await dormir(300);   // folga pra um aviso tardio aparecer, se o defeito voltar
  const v = await lerFotoEm(pgFoto);
  diz(`${rotulo}: o card pede a foto EM DECISÃO, com o sufixo que a varredura guardou`,
    v.src === arquivoEsperado + sufixo, JSON.stringify(v));
  diz(`${rotulo}: e ela ABRE sem rede, sem aviso, com o ✕ vivo`, v.fotoVisivel && !v.temAviso && v.rejVivo,
    JSON.stringify(v));
};
await montarNa(pgFoto, [FOTO_NA_2A, DENUNCIA_NA_3A]);
await conferirCardDeFoto('foto proposta na 2ª posição', FOTOS_REAIS[1]);
await montarNa(pgFoto, [DENUNCIA_NA_3A]);
await conferirCardDeFoto('foto denunciada na 3ª posição', FOTOS_REAIS[2]);

// O app RENASCE sem rede: nada em memória, nem a fila nem a janela. É o
// caminho de abertura de verdade (`offlineTentarAbrirSemRede`), e depois dele
// o baralho anda até o primeiro pedido de foto — os 4 da frente não têm foto.
const reaberta = await pgFoto.evaluate(async () => {
  offlineJanelaServida = null; offlineUltimoResultado = null;
  AppState.queue = []; AppState.currentPlace = null; AppState.serverTotal = 0; AppState.loadError = true;
  const abriu = await offlineTentarAbrirSemRede();
  return { abriu, n: AppState.queue.length, janela: offlineJanelaServida };
});
diz('REABERTA sem rede: volta a fila E a janela da última varredura completa',
  reaberta.abriu === true && reaberta.n === FILA_6C.length && reaberta.janela === enc6c.janela,
  JSON.stringify(reaberta));
await pgFoto.evaluate(() => {
  while (AppState.queue.length && !/PHOTO$/.test(AppState.queue[0].purType)) AppState.queue.shift();
  AppState.currentPlace = AppState.queue[0]; showCurrentPlace();
});
await conferirCardDeFoto('REABERTA, foto proposta na 2ª posição', FOTOS_REAIS[1]);
aviao = false;
await ctxFoto.close();

secao('7. A ESTRADA: marco o toggle, encho, entro no avião e volto');
// É o teste de ACEITAÇÃO do recurso — a promessa que o owner pediu em palavras:
// "sair de casa, marcar o toggle, sair tratando as solicitações e ter a mesma
// experiência como se tivesse rede". As seções acima medem peça por peça; esta
// mede o PERCURSO. Na main de antes do conserto ela reprova em três pontos, com
// os sintomas exatos do relato: o enchimento nunca termina, o mapa some, e a
// violação de CSP aparece na seção 9.
//
// A FOTO vem de um arquivo REAL do próprio servidor (mesma origem, logo
// permitida pela CSP, e com Cache-Control de verdade). MEDIDO com controle:
// `route.fulfill` NÃO popula o cache HTTP do navegador — a imagem interceptada
// carrega na 1ª vez e QUEBRA offline na 2ª, enquanto o mesmo byte vindo de um
// servidor de verdade volta do cache sem tocar a rede. Stub não consegue medir
// NADA que dependa do cache, e o cache é o mecanismo inteiro da foto offline.
//
// Metade dos pedidos vem SEM foto de propósito: com foto o 1º slide é a foto e
// o `.card-map` nasce `hidden`, então só os sem-foto respondem pelo mapa.
// Metade dos que TÊM foto é pedido DE FOTO (`NEW_PHOTO`). A estrada só usava
// `NEW_PLACE` — justamente o único tipo em que o defeito do aviso não podia
// aparecer —, e por isso "as fotos guardadas abriram SEM REDE" passava enquanto
// no aparelho todo card de "Nova foto" vinha vazio. A fixture não DISTINGUIA os
// casos (pergunta 2 do CLAUDE.md).
const ESTRADA = Array.from({ length: 12 }, (_, k) => {
  if (k % 2 !== 0) return { ...PLACE(40 + k), imageUrls: [], imageUrl: null };
  return { ...PLACE(40 + k, k % 4 === 0 ? 'NEW_PHOTO' : 'NEW_PLACE'), imageUrls: [BASE + FOTOS_REAIS[k % 3]] };
});
const api = [];
const rotaApi = (r) => { api.push(r.request().url().split('/api/')[1] + (aviao ? ' [AVIAO]' : ''));
  if (aviao) return r.abort('internetdisconnected');
  return r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }); };
await ctx.route('**/api/*', rotaApi);
await page.evaluate(() => {
  // A chave é `waze_session_token`. Sem ela o `_post` sai ANTES da rede, a ação
  // não chega a FALHAR por rede, e por isso não enfileira — o sintoma é
  // indistinguível de a fila de saída estar quebrada (foi o que me enganou).
  API.setSession('tok-estrada');
  // `undoEnabled:false` SOZINHO não desliga a janela do Desfazer: `canDisableUndo()`
  // também cobra a cota. Sem isto metade dos cliques bate em botão travado e eu
  // mediria a trava em vez do offline (a armadilha está escrita no CLAUDE.md).
  AppState.stats.read = 200;
  AppState.preferences.undoEnabled = false;
  AppState.preferences.offlineDisponivel = true;
});
await montar(ESTRADA);
await page.evaluate(() => { offlineJanelaServida = null; offlineUltimoResultado = null;
  offlineMarcarGesto(); return offlineVarrer(); });
await esperarNaPagina(page, () => offlineUltimoResultado !== null, 120000, 250);
const estradaEncheu = await page.evaluate(async () => {
  const c = await caches.open('waze-places-tiles');
  return { n: (await c.keys()).length, res: offlineUltimoResultado };
});
diz('encheu até o FIM (na main de antes NUNCA terminava — o "Preparando… 197 de 530")',
  estradaEncheu.res === 'pronto' && estradaEncheu.n > 0, JSON.stringify(estradaEncheu));

const tAntesDoAviao = await page.evaluate(() => Date.now());
aviao = true; await ctx.setOffline(true);
const tileAntes = rotaTile;
// A captura feita SEM REDE diz que estava sem rede, e em que pé estava o
// offline — o que o relato de 2026-09-22 não dizia: a janela sem sinal foi
// reconstruída de erro de rede, e a janela servida, do sufixo das fotos.
await esperarNaPagina(page, () => navigator.onLine === false, 5000);
const capturaNoAviao = await page.evaluate(() => {
  const m = dlogCapturar('manual');
  return m && { rede: m.rede, offline: m.offline };
});
// Encadeado com `?.` de propósito: sem o campo, a asserção tem de REPROVAR com
// nome, e não derrubar o smoke num TypeError — foi assim que a sabotagem que o
// tirava da captura passou por "sem falha" num contador de linhas ✗.
diz('a captura feita sem rede DIZ que estava sem rede, com o estado do offline',
  capturaNoAviao?.rede?.online === false && capturaNoAviao?.offline?.ligado === true
  && Number.isInteger(capturaNoAviao?.offline?.janelaServida) && capturaNoAviao?.offline?.resultado === 'pronto',
  JSON.stringify(capturaNoAviao));
const naEstrada = [];
for (let i = 0; i < 6; i++) {
  await dormir(600);
  naEstrada.push(await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const card = document.querySelector('#cardStack .place-card');
    const foto = card && card.querySelector('.card-image');
    const box = card && card.querySelector('.card-map');
    const tl = box ? [...box.querySelectorAll('.card-map-tiles img')] : [];
    const rej = card && card.querySelector('.card-btn-reject');
    // QUEM TEM FOTO é o PEDIDO que diz, nunca a tela. Classificado pelo que
    // estava visível, o card de foto com a foto ESCONDIDA pelo aviso caía no
    // grupo do mapa, e a falha saía como "os mapas desenharam 3/4" — nomeando
    // o sintoma errado (visto rodando este smoke contra a main de antes).
    const pl = AppState.currentPlace;
    return { temFoto: !!(pl && ((pl.imageUrls && pl.imageUrls.length) || pl.imageUrl)),
      fotoOk: !!(foto && !foto.classList.contains('hidden') && foto.naturalWidth > 0),
      aviso: !!(card && card.querySelector('.card-sem-foto')), tiles: tl.length,
      tilesOk: tl.filter((x) => x.naturalWidth > 0).length, rejVivo: !!(rej && !rej.disabled) };
  }));
  const antes = await page.evaluate(() => AppState.queue.length);
  await page.evaluate(() => { const b = document.querySelector('#cardStack .place-card .card-btn-reject');
    if (b && !b.disabled) b.click(); });
  // espera o RESULTADO (a fila andar), nunca um prazo: prazo mede o runner
  for (let j = 0; j < 40; j++) { if (await page.evaluate(() => AppState.queue.length) < antes) break; await dormir(100); }
}
const comFoto = naEstrada.filter((v) => v.temFoto);
const soMapa = naEstrada.filter((v) => !v.temFoto);
diz(`as fotos guardadas abriram SEM REDE, sem aviso (${comFoto.filter((v) => v.fotoOk && !v.aviso).length}/${comFoto.length})`,
  comFoto.length > 0 && comFoto.every((v) => v.fotoOk && !v.aviso), JSON.stringify(naEstrada));
diz(`os mapas guardados desenharam SEM REDE (${soMapa.filter((v) => v.tilesOk > 0).length}/${soMapa.length})`,
  soMapa.length > 0 && soMapa.every((v) => v.tilesOk > 0), JSON.stringify(soMapa.map((v) => v.tilesOk)));
diz('nenhuma requisição de tile saiu no avião — tudo veio do cache', rotaTile === tileAntes,
  `+${rotaTile - tileAntes}`);
diz('o ✕ ficou vivo nos 6 cards (nada ficou indecidível)', naEstrada.every((v) => v.rejVivo),
  JSON.stringify(naEstrada.map((v) => v.rejVivo)));
const naFila = await page.evaluate(() => { try {
  return JSON.parse(localStorage.getItem('waze_places_saida') || '[]').length; } catch (e) { return -1; } });
diz('as 6 ações viraram FILA DE SAÍDA — nada se perdeu', naFila === 6, 'fila=' + naFila);

aviao = false; await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
// Espera o esvaziamento ACABAR pela FONTE ÚNICA, nunca por prazo nem por
// `page.waitForFunction`: prazo mede a velocidade do runner (o `setTimeout` de
// 400ms por item é estrangulado lá), e o `waitForFunction` polla por rAF, usa
// o timer DA PÁGINA quando se pede `polling`, e — a que reprovou este bloco no
// CI — recebe as opções como ARGUMENTO na forma de 2 parâmetros, então nem o
// timeout nem o polling que você escreveu valem. O motivo é IMPRESSO: falha
// futura chega explicada em vez de virar adivinhação.
// O laço do esvaziamento dá `break` no PRIMEIRO `transient` e deixa o resto
// pra próxima — é decisão do produto (insistir em série gasta o free tier pra
// falhar). No aparelho real "a próxima" sempre chega: outro `online`, a prova
// de rede, a abertura do app. O teste dava UM gatilho só, então qualquer
// oscilação no runner deixava a fila pela metade e a culpa parecia do app —
// foi o que reprovou o CI (`fila:5`, 1 de 6). Aqui ele dá os gatilhos que o
// mundo dá, e IMPRIME quantas rodadas precisou: uma regressão que passe a
// exigir cinco aparece, em vez de se esconder atrás de um laço complacente.
let rodadas = 0;
let fimDaSaida = null;
for (; rodadas < 6; rodadas++) {
  fimDaSaida = await esperarFimDaSaida(page, 25000);   // teto é rede contra travar, não expectativa: local fecha em ~2,3s
  const resta = await page.evaluate(() => { try {
    return JSON.parse(localStorage.getItem('waze_places_saida') || '[]').length; } catch (e) { return -1; } });
  if (resta === 0) break;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await dormir(400);
}
console.log(`  · estrada [esvaziamento] rodadas=${rodadas + 1} ${JSON.stringify(fimDaSaida)}`);
const depoisDaEstrada = await page.evaluate(() => ({
  fila: JSON.parse(localStorage.getItem('waze_places_saida') || '[]').length,
  rej: AppState.stats.rejected }));
// Conta TENTATIVAS, não sucessos — e por isso o piso é `>= 6`, não `=== 6`.
// A entrega é AT-LEAST-ONCE por decisão de produto: um item que quebra em
// `transient` volta na rodada seguinte, e cravar a igualdade faria o teste
// reprovar justamente pelo comportamento que o app promete. Quem guarda o
// desperdício é o bloco da fila de saída no `smoke-browser.mjs` ("UMA
// requisição por ação"); quem guarda o que importa aqui é a linha de baixo —
// o placar NÃO pode contar duas vezes, e essa segue exata.
const saiuMesmo = api.filter((u) => /validar-place/.test(u) && !/AVIAO/.test(u)).length;
diz('a fila de saída ESVAZIOU quando a rede voltou', depoisDaEstrada.fila === 0, JSON.stringify(depoisDaEstrada));
diz(`as 6 saíram de verdade PELA REDE (${saiuMesmo} tentativas)`, saiuMesmo >= 6, JSON.stringify(api.slice(-3)));
diz('o placar não contou duas vezes', depoisDaEstrada.rej === 6, 'rejeitados=' + depoisDaEstrada.rej);
const redeNoDiario = await page.evaluate((t0) => dfatoAnel
  .filter((e) => e.t >= t0 && /^rede\./.test(e.k)).map((e) => e.k), tAntesDoAviao);
diz('o diário anota a rede CAINDO e depois VOLTANDO',
  redeNoDiario[0] === 'rede.caiu' && redeNoDiario.includes('rede.voltou'), JSON.stringify(redeNoDiario));
diz('sem rede, as 6 ações que falharam NÃO viraram erro no console (nem ruído no diário)',
  errosDeRedeNoAviao === 0, 'erros=' + errosDeRedeNoAviao);
await ctx.unroute('**/api/*', rotaApi);
await page.evaluate(() => { API.setSession(null); });

secao('7b. O REPORTE COM COMENTÁRIO (caixa curta) acha TODOS os seus tiles sem rede');
// A caixa do mapa é o que sobra depois do texto, e ENCOLHE no card com
// comentário de reporte ou diff — no aparelho do owner, 378×337 num card de foto
// e 378×189 no reporte da Marina. Caixa menor pode escolher OUTRO ZOOM, e a
// varredura calculava os tiles de todos os pedidos com a caixa do card que
// estivesse na frente: na fila real dele, 7 de 172 pedidos ficavam com buraco
// no mapa numa caixa de 189px. Hoje a varredura guarda a FAIXA de alturas.
//
// A geometria é ACHADA AQUI, com as caixas que esta tela deu, e a troca de zoom
// é PRÉ-CONDIÇÃO: sem ela, os tiles da caixa curta seriam subconjunto dos da
// alta e qualquer código passaria (gotcha #28 — teste que não pode reprovar).
const ALTO = { ...PLACE(60), imageUrls: [BASE + FOTOS_REAIS[0]] };
const CURTA = { ...PLACE(61, 'FLAGGED_PLACE'), updateTypeKey: 'FLAG', reqType: 'REQUEST', reqSubType: 'FLAG',
  flagType: 'CLOSED', imageUrls: [], imageUrl: null,
  flagComment: 'Mudou de nome e de dono. Agora é outro lugar, com outro horário e outra entrada pela rua de trás.' };
await montar([ALTO]);
const cxAlta = await page.evaluate(() => { const c = cardDaFrente().querySelector('.card-photo');
  return { w: c.clientWidth, h: c.clientHeight }; });
await montar([CURTA]);
const cxCurta = await page.evaluate(() => { const b = cardDaFrente().querySelector('.card-map');
  return { w: b.clientWidth, h: b.clientHeight }; });
const geo = await page.evaluate(({ a, c }) => {
  const C = [-22.90, -43.20];
  for (let dm = 20; dm <= 800; dm += 5) {
    const e = [C[0] + dm / 111320, C[1]];
    const za = mapaMontar([C, e], a.w, a.h, 'row'), zc = mapaMontar([C, e], c.w, c.h, 'row');
    if (za && zc && za.z !== zc.z) return { centro: C, entradas: [{ ll: e, estado: 'ok' }], dm, za: za.z, zc: zc.z };
  }
  return null;
}, { a: cxAlta, c: cxCurta });
diz('PRÉ-CONDIÇÃO: a caixa do reporte é mais CURTA e o zoom muda entre as duas',
  !!geo && cxCurta.h < cxAlta.h, JSON.stringify({ cxAlta, cxCurta, geo }));
CURTA.mapa = geo ? { centro: geo.centro, entradas: geo.entradas } : CURTA.mapa;
// a varredura roda com o card ALTO na frente, como no aparelho
await montar([ALTO, CURTA]);
await page.evaluate(() => { offlineJanelaServida = null; offlineUltimoResultado = null;
  offlineMarcarGesto(); return offlineVarrer(); });
await esperarNaPagina(page, () => offlineUltimoResultado !== null, 60000, 250);
aviao = true; await ctx.setOffline(true);
await montar([CURTA]);
const tilesDaCurta = () => { const b = cardDaFrente() && cardDaFrente().querySelector('.card-map');
  if (!b || !b.dataset.mapaW) return null;
  const pedidos = tilesDoCard(AppState.currentPlace, +b.dataset.mapaW, +b.dataset.mapaH).length;
  const ok = [...b.querySelectorAll('.card-map-tiles img')].filter((x) => x.naturalWidth > 0).length;
  return { pedidos, ok }; };
// sinal positivo: todos os pedidos desenhados. Tile que falha SAI do DOM, então
// no defeito isto não se cumpre e a espera bate no teto — daí o teto curto.
await esperarNaPagina(page, () => { const b = cardDaFrente() && cardDaFrente().querySelector('.card-map');
  if (!b || !b.dataset.mapaW) return false;
  const n = tilesDoCard(AppState.currentPlace, +b.dataset.mapaW, +b.dataset.mapaH).length;
  return n > 0 && [...b.querySelectorAll('.card-map-tiles img')].filter((x) => x.naturalWidth > 0).length === n; }, 8000);
const curta = await page.evaluate(tilesDaCurta);
diz('TODOS os tiles do mapa curto aparecem sem rede (o card da Marina)',
  !!curta && curta.pedidos > 0 && curta.ok === curta.pedidos, JSON.stringify(curta));
aviao = false; await ctx.setOffline(false);

secao('7c. O ANDROID ENCERRA O SERVICE WORKER OCIOSO — e o mapa guardado não pode sumir');
// Service worker é EFÊMERO: o Chrome o encerra depois de ~30s parado e o recria
// no próximo evento, com as variáveis globais ZERADAS. A lista de tiles
// guardados vivia numa dessas e só era lida no `activate` (que não roda numa
// recriação) — então, depois da primeira pausa de meio minuto, o worker
// acordava sem saber de tile nenhum e, sem rede, o mapa sumia. É o card da
// Marina no relato: mapa sem um tile, com 243 guardados no cache. Nenhum teste
// pegava porque num teste curto o worker não chega a adormecer — aqui ele é
// encerrado à força, pelo DevTools Protocol, que é o que o Android faz sozinho.
await montar([SO_MAPA(70), SO_MAPA(71)]);
await page.evaluate(() => { offlineJanelaServida = null; offlineUltimoResultado = null;
  offlineMarcarGesto(); return offlineVarrer(); });
await esperarNaPagina(page, () => offlineUltimoResultado !== null, 60000, 250);
aviao = true; await ctx.setOffline(true);
const tileNaFrente = () => page.evaluate(() => { const b = cardDaFrente() && cardDaFrente().querySelector('.card-map');
  const tl = b ? [...b.querySelectorAll('.card-map-tiles img')] : [];
  return { tiles: tl.length, ok: tl.filter((x) => x.naturalWidth > 0).length }; });
await montar([SO_MAPA(70)]);
await esperarNaPagina(page, () => { const b = cardDaFrente() && cardDaFrente().querySelector('.card-map');
  return !!b && [...b.querySelectorAll('.card-map-tiles img')].some((x) => x.naturalWidth > 0); }, 8000);
const comWorkerVivo = await tileNaFrente();
diz('CONTROLE: com o worker vivo, o tile guardado aparece sem rede', comWorkerVivo.ok > 0, JSON.stringify(comWorkerVivo));
const cdp = await ctx.newCDPSession(page);
let estadosDoWorker = [];
cdp.on('ServiceWorker.workerVersionUpdated', (e) => { estadosDoWorker = e.versions.map((v) => v.runningStatus); });
await cdp.send('ServiceWorker.enable');
await cdp.send('ServiceWorker.stopAllWorkers');
// CONTROLE do instrumento: o worker foi MESMO encerrado. Sem isto, a asserção
// de baixo passaria com ele vivo — e mediria o caso que já funcionava.
for (let i = 0; i < 30 && !estadosDoWorker.includes('stopped'); i++) await dormir(100);
diz('CONTROLE: o service worker foi de fato ENCERRADO', estadosDoWorker.includes('stopped'),
  JSON.stringify(estadosDoWorker));
await montar([SO_MAPA(71)]);
await esperarNaPagina(page, () => { const b = cardDaFrente() && cardDaFrente().querySelector('.card-map');
  return !!b && [...b.querySelectorAll('.card-map-tiles img')].some((x) => x.naturalWidth > 0); }, 8000);
const acordou = await tileNaFrente();
diz('o worker ACORDOU sabendo dos tiles: o mapa guardado aparece sem rede', acordou.ok > 0 && acordou.ok === acordou.tiles,
  JSON.stringify(acordou));
// O worker recriado responde ao diagnóstico pela boca DELE — e é esta a
// resposta que teria mostrado o defeito do relato sem precisar reproduzi-lo:
// nascido agora, lista lida, servindo do cache.
const guardadosAgora = await page.evaluate(async () => (await (await caches.open('waze-places-tiles')).keys()).length);
const doSw = await page.evaluate(() => diagServiceWorker());
diz('o worker RECRIADO se apresenta: nasceu há pouco, com a lista lida e servindo do cache',
  !!doSw && doSw.idadeMs < 60000 && doSw.listaPronta === true && doSw.tilesNaLista === guardadosAgora && doSw.doCache > 0,
  JSON.stringify(doSw) + ' cache=' + guardadosAgora);
const falhasGuardadas = await page.evaluate(() => diagTilesGuardadosQueFalharam.length);
diz('nenhum tile GUARDADO falhou na tela — é o que a sentinela do mapa acusaria',
  falhasGuardadas === 0, 'anel=' + falhasGuardadas);
aviao = false; await ctx.setOffline(false);

secao('7d. A PREPARAÇÃO INTERROMPIDA: o sinal cai no meio, e o que JÁ foi guardado aparece');
// Só o "pronto" avisava o service worker, e ele só serve o tile que CONHECE. A
// preparação interrompida — o sinal caindo no meio, o caso comum de quem sai
// de casa — deixava tiles NO APARELHO que o card não mostrava. Achado
// desenhando a sentinela do mapa, que acusaria exatamente isto.
//
// DOIS controles, porque dois atalhos fariam esta seção passar sem medir o
// conserto: a varredura tem que ter terminado PARCIAL (senão é o caminho do
// "pronto", que sempre avisou), e o worker NÃO pode ter sido recriado no meio
// (recriado, ele relê o cache na partida e acharia os tiles por outro motivo).
const ALVO_7D = { ...SO_MAPA(90), mapa: { centro: [-10.5, -40.5], entradas: [] } };
const RESTO_7D = Array.from({ length: 8 }, (_, k) =>
  ({ ...SO_MAPA(91 + k), mapa: { centro: [-10.5 + (k + 1) * 0.7, -40.5], entradas: [] } }));
await montar([ALVO_7D, ...RESTO_7D]);
const swAntes7d = await page.evaluate(() => diagServiceWorker());
// O ALVO chega rápido e o RESTO demora. A folga entre "o alvo está guardado" e
// "o sinal cai" é o tempo do resto, e é ela que decide se a varredura termina
// PARCIAL. Com 250ms pra todo tile ela ficava ABAIXO de 1,5s — MEDIDO: a
// sabotagem que atrasava em 1,5s a resposta do worker bastava pra fechá-la, e
// a varredura terminava PRONTA. Com o resto a 4s, um runner lento não a fecha.
const urlsDoAlvo7d = new Set(await page.evaluate(() => [...tilesDaFaixa(AppState.queue[0], offlineFaixaDeCaixas())]));
atrasoTile = (url) => (urlsDoAlvo7d.has(url) ? 250 : 4000);
await page.evaluate(() => { offlineUltimoResultado = null; offlineMarcarGesto(); offlineVarrer(); });
// Sinal POSITIVO: todos os tiles do ALVO (o 1º da fila) já estão no cache.
const alvoNoCache = await esperarNaPagina(page, async () => {
  const urls = [...tilesDaFaixa(AppState.queue[0], offlineFaixaDeCaixas())];
  if (!urls.length) return false;
  for (const u of urls) if (!(await caches.match(u, { cacheName: 'waze-places-tiles' }))) return false;
  return true;
}, 30000, 100);
const swNoMeio = await page.evaluate(() => diagServiceWorker());
aviao = true; await ctx.setOffline(true);
await esperarNaPagina(page, () => !offlineVarrendo, 20000, 100);
const fim7d = await page.evaluate(() => ({ res: offlineUltimoResultado }));
atrasoTile = 0;
// `Number.isInteger`/`isFinite` antes da igualdade: com o worker MUDO, os dois
// lados viriam `undefined` e `undefined === undefined` passaria por vácuo.
diz('PRÉ-CONDIÇÃO: os tiles do alvo chegaram ao cache ANTES do sinal cair, sem aviso ao worker no meio',
  alvoNoCache.ok && Number.isInteger(swAntes7d.tilesNaLista) && swNoMeio.tilesNaLista === swAntes7d.tilesNaLista,
  JSON.stringify({ alvoNoCache, alvo: urlsDoAlvo7d.size, antes: swAntes7d.tilesNaLista, noMeio: swNoMeio.tilesNaLista }));
diz('PRÉ-CONDIÇÃO: a preparação terminou PARCIAL (o sinal caiu no meio)', fim7d.res === 'parcial', JSON.stringify(fim7d));
const anel7dAntes = await page.evaluate(() => diagTilesGuardadosQueFalharam.length);
await montar([ALVO_7D]);
await esperarNaPagina(page, () => { const b = cardDaFrente() && cardDaFrente().querySelector('.card-map');
  return !!b && Number(b.dataset.tilesPedidos) > 0
    && [...b.querySelectorAll('.card-map-tiles img')].every((x) => x.complete); }, 8000);
await dormir(300);
const mapa7d = await page.evaluate(() => { const b = cardDaFrente().querySelector('.card-map');
  const tl = [...b.querySelectorAll('.card-map-tiles img')];
  return { pedidos: Number(b.dataset.tilesPedidos), falharam: Number(b.dataset.tilesFalharam),
           ok: tl.filter((x) => x.naturalWidth > 0).length }; });
const swDepois7d = await page.evaluate(() => diagServiceWorker());
diz('CONTROLE: o worker NÃO foi recriado no meio (senão a partida dele mascararia o defeito)',
  Number.isFinite(swAntes7d.iniciadoEm) && swDepois7d.iniciadoEm === swAntes7d.iniciadoEm,
  `${swAntes7d.iniciadoEm} → ${swDepois7d.iniciadoEm}`);
diz('o mapa guardado numa preparação INTERROMPIDA aparece sem rede, inteiro',
  mapa7d.pedidos > 0 && mapa7d.falharam === 0 && mapa7d.ok === mapa7d.pedidos, JSON.stringify(mapa7d));
const anel7d = await page.evaluate(() => diagTilesGuardadosQueFalharam.length);
diz('e a sentinela do mapa não tem o que acusar', anel7d === anel7dAntes, `${anel7dAntes} → ${anel7d}`);
aviao = false; await ctx.setOffline(false);

secao('8. O DEPLOY NÃO APAGA O MAPA PROVISIONADO');
// O `activate` apaga TODO cache ≠ CACHE_NAME. Sem a isenção do TILES_CACHE,
// cada deploy levaria junto o mapa que o editor provisionou — e ele só
// descobriria na estrada, sem sinal pra refazer. O guard de fonte lê a linha
// do `if`; aqui a FAXINA RODA DE VERDADE, no service worker de verdade.
//
// Como o deploy é encenado, e por que não de outro jeito (os três MEDIDOS):
//   • reescrever o `service-worker.js` pelo `ctx.route` — IMPOSSÍVEL: o route
//     não vê o script do SW (0 requisições de 0), porque quem o busca é o
//     NAVEGADOR, não a página;
//   • `unregister()` + `register()` na MESMA URL — não reinstala nada: volta
//     em 9ms e a isca continua viva 20s depois;
//   • `register('/service-worker.js?deploy=2')` — URL de script diferente no
//     MESMO escopo, então o navegador INSTALA uma versão nova. Ela fica em
//     `waiting` (a página segue controlada pela antiga) até alguém mandar
//     `SKIP_WAITING` — que é exatamente o que o `js/sw-register.js` faz num
//     deploy real. Aqui o teste manda, porque o ouvinte dele está pendurado
//     na registração que o app criou no `load`, não na que o teste provocou.
//
// A ISCA é um cache no nome de uma versão anterior: é o que a faxina precisa
// levar, ao lado do de tiles que ela precisa poupar. E ela é metade do teste —
// sem o controle, "o mapa sobreviveu" passa por vácuo no dia em que a faxina
// parar de rodar. Passou mesmo, na primeira versão desta seção (gotcha #28).
const ISCA = 'waze-places-2020010101';
const antesDoDeploy = await page.evaluate(async (isca) => {
  const d = await caches.open(isca);
  await d.put(new Request('/manifest.json'), new Response('isca'));
  const c = await caches.open('waze-places-tiles');
  return { tiles: (await c.keys()).length, nomes: await caches.keys() };
}, ISCA);
diz('antes do deploy: há tile guardado E a isca de versão anterior no lugar',
  antesDoDeploy.tiles > 0 && antesDoDeploy.nomes.includes(ISCA), JSON.stringify(antesDoDeploy));

await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.register('/service-worker.js?deploy=2');
  const pular = (w) => {
    if (!w) return;
    if (w.state === 'installed') { w.postMessage({ type: 'SKIP_WAITING' }); return; }
    w.addEventListener('statechange', () => {
      if (w.state === 'installed') w.postMessage({ type: 'SKIP_WAITING' });
    });
  };
  pular(reg.waiting); pular(reg.installing);
  reg.addEventListener('updatefound', () => pular(reg.installing));
}).catch(() => { /* a troca de controller derruba o evaluate; o que vale é o cache */ });
// A troca de controller RECARREGA a página (o auto-update do app fazendo o que
// promete), e isso ABORTA um `waitForFunction` no meio: ele volta sem erro e a
// medição acontece ANTES da faxina — foi o que fez esta seção reprovar três
// vezes com o código certo. A espera tem que sobreviver à navegação, então é
// um laço que tolera o contexto morrer e para por SINAL POSITIVO (a isca
// sumiu), com teto.
let depoisDoDeploy = { nomes: [], tiles: -1 };
for (let i = 0; i < 75; i++) {
  const r = await page.evaluate(async () => {
    const nomes = await caches.keys();
    const c = await caches.open('waze-places-tiles');
    return { nomes, tiles: (await c.keys()).length };
  }).catch(() => null);
  if (r) { depoisDoDeploy = r; if (!r.nomes.includes(ISCA)) break; }
  await dormir(400);
}
diz('a FAXINA RODOU: a isca da versão anterior foi embora (sem isto o resto passa por vácuo)',
  depoisDoDeploy.nomes.length > 0 && !depoisDoDeploy.nomes.includes(ISCA),
  JSON.stringify(depoisDoDeploy));
diz('e o cache do MAPA sobreviveu INTEIRO ao deploy',
  depoisDoDeploy.tiles === antesDoDeploy.tiles && depoisDoDeploy.nomes.includes('waze-places-tiles'),
  `antes=${antesDoDeploy.tiles} depois=${depoisDoDeploy.tiles}`);

// A troca de controller RECARREGA a página (é o auto-update do app fazendo o
// que promete). Espere ela assentar e devolva o estado que a seção seguinte
// precisa — sem isto o `offlineVarrer()` de lá roda com fila vazia e a
// asserção "o cache ficou vazio" passa por vácuo.
await page.waitForLoadState('load').catch(() => {});
await esperarNaPagina(page, () => typeof offlineVarrer === 'function', 20000);
await page.evaluate(() => { AppState.preferences.offlineDisponivel = true; }).catch(() => {});
await montar([PLACE(1), PLACE(2), PLACE(3)]);

secao('8b. O DIAGNÓSTICO ENXERGA O OFFLINE — e o worker responde por si');
// O relatório do relato de 2026-09-22 decidiu o conserto e mesmo assim custou
// tempo: não trazia o estado do offline, o worker era caixa-preta, o tile que
// falhava sumia com a prova, e a lista de recursos bateu no teto. Cada linha
// aqui mede, no app de verdade, uma dessas lacunas fechada.
const noRelatorio = await page.evaluate(async () => ({ off: await diagOffline(), sw: await diagServiceWorker() }));
diz('a seção offline diz o que o aparelho guardou: fila, janela e tiles',
  noRelatorio.off?.ligado === true && noRelatorio.off?.tilesNoCache > 0
  && noRelatorio.off?.filaGuardada?.n > 0
  && Number.isFinite(noRelatorio.off?.janelaGuardada), JSON.stringify(noRelatorio.off));
diz('o worker responde pela boca dele, e conhece EXATAMENTE os tiles do cache',
  noRelatorio.sw?.listaPronta === true
  && Number.isInteger(noRelatorio.sw?.tilesNaLista) && noRelatorio.sw.tilesNaLista === noRelatorio.off?.tilesNoCache
  && /^waze-places-\d{10}$/.test(noRelatorio.sw?.versao || ''), JSON.stringify(noRelatorio.sw));
// O RELATÓRIO DE VERDADE, pelo caminho do botão: `baixarDiagnostico()` junta
// as peças em `diagCorpo()` (com os `await` novos), serializa, empacota em ZIP
// e baixa — e ele é lido pela FONTE ÚNICA das ferramentas (`diag-ler.mjs`). As
// medidas acima são das PEÇAS, e nenhum smoke gerava o arquivo: um `await` que
// rejeitasse ali derrubaria o relatório inteiro, não só a seção nova. Só a
// FORMA é conferida e nada do arquivo é impresso — ele leva o token da sessão
// (de teste, aqui, mas a regra não tem exceção).
//
// Estado FRESCO primeiro: a troca de worker da seção 8 RECARREGOU a página, e
// com ela foram o diário e as capturas da estrada. Cai a rede, captura, volta.
aviao = true; await ctx.setOffline(true);
await esperarNaPagina(page, () => navigator.onLine === false, 5000);
await page.evaluate(() => { dlogCapturar('manual'); });
aviao = false; await ctx.setOffline(false);
await esperarNaPagina(page, () => navigator.onLine === true, 5000);
await dormir(300);   // o `online` dispara gatilhos (varredura); deixa nascerem, e espera acabarem
await esperarNaPagina(page, () => !offlineVarrendo, 30000, 100);
const dirDiag = mkdtempSync(join(tmpdir(), 'diag-offline-'));
let relatorio;
try {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.evaluate(() => baixarDiagnostico()),
  ]);
  const arq = join(dirDiag, 'diag.zip');
  await dl.saveAs(arq);
  const { dados: d, origem } = lerDiagnostico(arq);
  const momentos = d.momentos || [];
  relatorio = {
    origem, v: d._versaoDoDiag, rede: d.resumo?.rede, offline: d.resumo?.offline,
    alertas: (d.resumo?.alertas || []).map((a) => a.chave),
    offLigado: d.offline?.ligado, offTiles: d.offline?.tilesNoCache,
    swPronta: d.serviceWorker?.proprio?.listaPronta, swLista: d.serviceWorker?.proprio?.tilesNaLista,
    recN: d.recursosInfo?.n, recLen: Array.isArray(d.recursos) ? d.recursos.length : null,
    capturas: momentos.length,
    capturaSemRede: momentos.filter((m) => m.rede?.online === false && m.offline?.ligado === true).length,
    redeNoDiario: (d.diario || []).filter((e) => /^rede\./.test(e.k)).map((e) => e.k),
    // O `codigo` enxuto (v2026.09.24-02): tamanho, hash e versão; o corpo, só do
    // CSS. E o `cacheVsRede` tem que ter comparado ANTES de o corpo sair.
    app: d.app?.versao,
    codigo: (() => {
      const e = Object.entries(d.codigo || {});
      return {
        n: e.length,
        comCorpo: e.filter(([, v]) => v && typeof v.corpo === 'string').map(([u]) => u.replace(/^https?:\/\/[^/]+/, '')),
        semHash: e.filter(([, v]) => v && !v.erro && !v.hash).length,
        versoes: [...new Set(e.map(([, v]) => v && v.versao).filter(Boolean))],
      };
    })(),
    cvr: (() => {
      const e = Object.values(d.cacheVsRede || {});
      return { n: e.length, semCorpoLocal: e.filter((v) => v && v.erro === 'sem corpo local').length };
    })(),
  };
} catch (e) {
  relatorio = { erro: String((e && e.message) || e).slice(0, 200) };
} finally {
  rmSync(dirDiag, { recursive: true, force: true });
}
diz('o RELATÓRIO de verdade (baixado em ZIP, lido pela ferramenta) traz as peças novas',
  // `>= 3`: a versão que TROUXE estas peças. Cravar o número quebrava a cada
  // versão nova do formato, que é aditivo por contrato.
  relatorio.origem === 'zip' && relatorio.v >= 3 && relatorio.rede === true
  && ['pronto', 'parcial', 'ligado'].includes(relatorio.offline)
  && relatorio.offLigado === true && relatorio.offTiles > 0
  // worker × cache: a IGUALDADE está medida nas peças, logo acima; aqui é a
  // forma, e a volta da rede pode ter posto uma varredura no meio do arquivo
  && relatorio.swPronta === true && relatorio.swLista > 0
  && relatorio.recN > 0 && relatorio.recN === relatorio.recLen,
  JSON.stringify(relatorio));
diz('e leva o que aconteceu: a captura SEM rede e a queda e a volta no diário',
  relatorio.capturaSemRede >= 1 && relatorio.redeNoDiario?.includes('rede.caiu')
  && relatorio.redeNoDiario.includes('rede.voltou'), JSON.stringify(relatorio));
diz('o CÓDIGO sai enxuto (tamanho, hash e versão; o corpo só do CSS) e o cacheVsRede segue comparando',
  relatorio.codigo?.n > 0 && relatorio.codigo.comCorpo.length >= 1
  && relatorio.codigo.comCorpo.every((u) => /\.css(\?|$)/.test(u)) && relatorio.codigo.semHash === 0
  && relatorio.codigo.versoes.length === 1 && relatorio.codigo.versoes[0] === relatorio.app
  && relatorio.cvr?.n > 0 && relatorio.cvr.semCorpoLocal === 0,
  JSON.stringify({ app: relatorio.app, codigo: relatorio.codigo, cvr: relatorio.cvr }));
diz('no estado são, as duas sentinelas NOVAS ficam caladas no relatório',
  Array.isArray(relatorio.alertas) && !relatorio.alertas.includes('fotoEscondidaComAviso')
  && !relatorio.alertas.includes('tileGuardadoFalhou'), JSON.stringify(relatorio.alertas));
// A SENTINELA do mapa, dos dois lados. O defeito natural (o worker acordando
// sem a lista) está medido na 7c; aqui a falha é ENCENADA, nas condições que o
// app exige: worker no comando, varredura parada e o tile no cache — e um
// tile que NÃO está guardado falhando junto, que não pode entrar.
const sentMapa = await page.evaluate(async () => {
  for (let i = 0; i < 100 && offlineVarrendo; i++) await new Promise((r) => setTimeout(r, 50));
  const guardado = (await (await caches.open('waze-places-tiles')).keys())[0].url;
  diagTilesGuardadosQueFalharam = [];
  offlineUltimoAnuncio = 0;   // longe de qualquer aviso: a janela de 2s não se aplica
  const semAlerta = diagSentinelas(diagComputado()).map((a) => a.chave);
  registrarFalhaDeTile(null, 'https://www.waze.com/row-tiles/live/base/3/0/0/tile.png');
  registrarFalhaDeTile(null, guardado);
  for (let i = 0; i < 40 && !diagTilesGuardadosQueFalharam.length; i++) await new Promise((r) => setTimeout(r, 25));
  await new Promise((r) => setTimeout(r, 150));   // folga pro não guardado, se ele entrasse (errado)
  const r = { semAlerta, anel: diagTilesGuardadosQueFalharam.map((x) => (x.url === guardado ? 'guardado' : x.url)),
              comAlerta: diagSentinelas(diagComputado()).map((a) => a.chave) };
  diagTilesGuardadosQueFalharam = [];
  return r;
});
diz('CONTROLE: sem falha registrada, a sentinela do mapa cala',
  !sentMapa.semAlerta.includes('tileGuardadoFalhou'), JSON.stringify(sentMapa));
diz('o tile GUARDADO que falha entra no anel — e o que não está guardado, não',
  sentMapa.anel.length === 1 && sentMapa.anel[0] === 'guardado', JSON.stringify(sentMapa));
diz('e a sentinela do mapa acusa', sentMapa.comAlerta.includes('tileGuardadoFalhou'), JSON.stringify(sentMapa));
// A LISTA DE RECURSOS: o navegador guarda 250 e descarta o resto. Página nova
// em cada medida (o teto vale por documento), sem worker nem rota, e 300
// requisições de mesma origem. O CONTROLE é a de baixo: sem ele, "passou de
// 300 com o dev" não distingue teto que subiu de teto que nunca existiu.
const ctxR = await browser.newContext({ serviceWorkers: 'block' });
const medirRecursos = async (comDev) => {
  const pg = await ctxR.newPage();
  pg.on('pageerror', (e) => errosJs.push({ secao: secaoAtual, txt: String(e.message) }));
  await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await esperarNaPagina(pg, () => typeof diagAjustarRecursos === 'function', 10000);
  const r = await pg.evaluate(async (comDev) => {
    if (comDev) { AppState.devMode = { unlocked: true, active: true }; diagAjustarRecursos(); }
    // O corpo é LIDO: a entrada de Resource Timing só nasce quando a resposta
    // termina, e sem ler as últimas ainda não tinham pousado quando a lista
    // era contada (medido: 296 de 313, variando). Depois, espera a contagem
    // PARAR de mudar — o resultado, nunca um prazo.
    for (let i = 0; i < 300; i++) { try { await (await fetch('/manifest.json?rec=' + i)).text(); } catch (e) { /* conta igual */ } }
    let n = -1;
    for (let k = 0; k < 40; k++) {
      await new Promise((r) => setTimeout(r, 100));
      const agora = performance.getEntriesByType('resource').length;
      if (agora === n) break;
      n = agora;
    }
    return { n, encheu: diagRecursosCheio };
  }, comDev);
  await pg.close();
  return r;
};
const recSemDev = await medirRecursos(false);
const recComDev = await medirRecursos(true);
diz('CONTROLE: sem o dev, a lista para no teto do navegador — e o relatório SABE que encheu',
  recSemDev.n === 250 && recSemDev.encheu === true, JSON.stringify(recSemDev));
diz('com o dev ligado o teto sobe e nada se perde',
  recComDev.n > 300 && recComDev.encheu === false, JSON.stringify(recComDev));
await ctxR.close();

secao('9. ESQUECER PARA a varredura em voo (privacidade)');
// Enche, e ESQUECE no meio: o download já a caminho não pode pousar depois.
await page.evaluate(() => { offlineJanelaServida = null; offlineUltimoResultado = null;
  AppState.preferences.offlineDisponivel = true; offlineMarcarGesto(); offlineVarrer(); });
await dormir(60);
// Uma entrada no anel ANTES de esquecer: sem ela, "o anel ficou vazio" passaria
// por vácuo — ele já está vazio a esta altura.
await page.evaluate(() => { diagTilesGuardadosQueFalharam.push({ t: Date.now(), url: 'https://www.waze.com/row-tiles/live/base/3/1/1/tile.png' }); });
// Idem a lista do WORKER: ela tem de estar CHEIA antes, senão "esqueceu" passa
// por vácuo.
const swAntes9 = await page.evaluate(() => diagServiceWorker());
await page.evaluate(() => offlineEsquecer());
await dormir(900);
const swDepois9 = await page.evaluate(() => diagServiceWorker());
const depois = await page.evaluate(async () => {
  const c = await caches.open('waze-places-tiles');
  return { cache: (await c.keys()).length, fila: !!(await offlineLerFila()),
    janela: offlineJanelaServida, res: offlineUltimoResultado,
    janelaGuardada: await offlineLerJanela(), anel: diagTilesGuardadosQueFalharam.length };
});
diz('depois de esquecer, o cache de tiles fica VAZIO', depois.cache === 0, JSON.stringify(depois));
diz('a fila guardada some e a janela zera', depois.fila === false && depois.janela === null, JSON.stringify(depois));
diz('e a janela GRAVADA e o anel de tiles que falharam somem junto (dizem onde ficam pedidos de terceiros)',
  depois.janelaGuardada === null && depois.anel === 0, JSON.stringify(depois));
diz('e o worker esquece a LISTA dele (o mesmo dado, em memória)',
  swAntes9?.tilesNaLista > 0 && swDepois9?.tilesNaLista === 0,
  `${swAntes9?.tilesNaLista} → ${swDepois9?.tilesNaLista}`);

secao('9b. O QUE FOI TRATADO NÃO VOLTA — reabrir no meio da triagem, com e sem rede');
// O relato de 2026-09-22 (o terceiro do dia): preparou o offline, fechou, entrou
// no avião, reabriu, tratou uns pedidos (foram pra fila de saída), fechou e
// reabriu — e os MESMOS pedidos voltaram como card, com a fila de saída ainda
// segurando as decisões. Dava pra decidir de novo: o placar contava outra vez e
// o Waze recebia duas decisões, que podem ser DIFERENTES (ler não resolve o
// pedido, então um "rejeitar" depois dele vale).
//
// A causa: a fila guardada é uma FOTO tirada com rede, e a reabertura sem rede
// a restaurava inteira. Esta seção encena o percurso dele em páginas NOVAS, com
// o app de verdade decidindo, e mais os três vizinhos que a mesma regra cobre:
// o pedido tratado COM rede depois da foto, a ação que estava na janela do
// Desfazer quando o app foi fechado, e a busca da reabertura COM rede correndo
// junto do esvaziamento da fila de saída.
//
// CONTROLE que torna a seção honesta: a fila guardada tem que continuar com os
// CINCO pedidos (a foto é de antes das decisões). Se ela fosse regravada, a
// reabertura esconderia os decididos por outro motivo e o filtro não estaria
// sendo medido.
aviao = false; await ctx.setOffline(false);
const DEC_9B = [101, 102, 103, 104, 105].map((i) => SO_MAPA(i));
// A chave do pedido é calculada AQUI e dentro da página, à mão, e nunca pela
// `chaveDoPedido` do app: assim esta seção roda igual contra o app de ANTES do
// conserto — que é como se prova que ela reprova o defeito, e não uma função
// que ainda não existia.
const chave9b = (p) => p.venueID + '|' + p.updateRequestID;
// O "Waze" desta seção: o conjunto de pedidos PENDENTES, que perde o pedido
// quando a decisão chega — e a lista da busca é tirada na CHEGADA do pedido,
// não na resposta, como no Waze de verdade. É isso que abre a corrida.
const pendentes9b = new Map(DEC_9B.map((p) => [chave9b(p), p]));
const decisoes9b = [];              // cada decisão que CHEGOU: { chave, rota, t }
const buscas9b = [];                // cada busca: { tPedido, tResposta, lista }
let atrasoBusca9b = 0;
let atrasoDecisao9b = () => 0;
// "LIE-FI" (passo 9): o rádio diz `onLine`, e a decisão não passa — túnel,
// portal cativo. Só as escritas: é o envio da descarga que morre.
let lieFi9b = false;
const rotaApi9b = async (r) => {
  const rota = r.request().url().split('/api/')[1];
  if (lieFi9b && (rota === 'marcar-lido' || rota === 'validar-place')) return r.abort('timedout');
  if (aviao) return r.abort('internetdisconnected');
  let corpo = {};
  try { corpo = JSON.parse(r.request().postData() || '{}'); } catch (e) { /* corpo vazio */ }
  const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (rota === 'buscar-places') {
    const b = { tPedido: Date.now(), lista: [...pendentes9b.keys()] };
    const places = [...pendentes9b.values()];
    if (atrasoBusca9b) await dormir(atrasoBusca9b);
    b.tResposta = Date.now();
    buscas9b.push(b);
    return json({ success: true, places, hasMore: false, page: 1, total: places.length });
  }
  if (rota === 'marcar-lido' || rota === 'validar-place') {
    const chave = corpo.venueID + '|' + corpo.updateRequestID;
    const espera = atrasoDecisao9b(chave);
    if (espera) await dormir(espera);
    decisoes9b.push({ chave, rota, t: Date.now() });
    pendentes9b.delete(chave);
    return json({ success: true });
  }
  if (rota === 'perfil') {
    return json({ success: true, profile: { id: 1, userName: 'e', rank: 5, isAreaManager: true, isStaff: false, editableCountryIDs: [30], areas: [] } });
  }
  // Presença, países e o resto ficam fora do que esta seção mede.
  return r.abort('failed');
};
await ctx.route('**/api/*', rotaApi9b);
await page.evaluate(() => {
  localStorage.removeItem('waze_places_saida');
  localStorage.removeItem('waze_places_offline_pousos');
  API.setSession('tok-9b');
  // Cota do Desfazer batida (senão metade dos cliques bate em botão travado) e
  // GRAVADA: as páginas novas leem do armazenamento, não desta memória.
  AppState.stats = { read: 200, rejected: 0, skipped: 0 };
  saveStats();
  AppState.preferences.undoEnabled = false;
  AppState.preferences.offlineDisponivel = true;
  AppState.preferences.comoFuncionaVisto = true;
  savePreferences();
});
const historico9b = (pg) => pg.evaluate(() => { try {
  const t = JSON.parse(localStorage.getItem('waze_places_history') || '{}')._total || {};
  return { read: t.read || 0, rejected: t.rejected || 0 }; } catch (e) { return null; } });
const histAntes9b = await historico9b(page);
await montar(DEC_9B.map((p) => ({ ...p })));
await page.evaluate(() => { offlineJanelaServida = null; offlineUltimoResultado = null;
  offlineMarcarGesto(); offlineVarrer(); });
await esperarNaPagina(page, () => offlineUltimoResultado !== null, 60000, 250);
const foto9b = await page.evaluate(async () => ({ res: offlineUltimoResultado,
  n: ((await offlineLerFila()) || {}).places?.length }));
diz('PRÉ-CONDIÇÃO: com rede, a preparação ENCHEU e a fila guardada tem os 5',
  foto9b.res === 'pronto' && foto9b.n === 5, JSON.stringify(foto9b));

// Lê a fila de saída do ARMAZENAMENTO, que é o que sobrevive a fechar o app.
const saida9b = (pg) => pg.evaluate(() => { try {
  return JSON.parse(localStorage.getItem('waze_places_saida') || '[]')
    .map((it) => ({ chave: it.venueID + '|' + it.updateRequestID, tipo: it.tipo }));
} catch (e) { return null; } });
// Decide o card da FRENTE pelo botão e espera o RESULTADO: a fila andar e, se
// `esperarSaida`, a decisão cair na fila de saída.
const decidir9b = async (pg, botao, esperarSaida) => {
  const antes = await pg.evaluate(() => ({ k: AppState.currentPlace ? AppState.currentPlace.venueID + '|' + AppState.currentPlace.updateRequestID : null, n: AppState.queue.length,
    s: JSON.parse(localStorage.getItem('waze_places_saida') || '[]').length }));
  await pg.evaluate((b) => cardDaFrente().querySelector(b).click(), botao);
  for (let j = 0; j < 60; j++) {
    const agora = await pg.evaluate(() => ({ n: AppState.queue.length,
      s: JSON.parse(localStorage.getItem('waze_places_saida') || '[]').length }));
    if (agora.n < antes.n && (!esperarSaida || agora.s > antes.s)) break;
    await dormir(100);
  }
  return antes.k;
};

// 1. COM rede, depois da foto: o ✕ pousa no Waze e a foto não sabe disso.
const k101 = await decidir9b(page, '.card-btn-reject', false);
for (let j = 0; j < 50 && !decisoes9b.some((d) => d.chave === k101); j++) await dormir(100);
const pousos9b = await page.evaluate(() => { try {
  return JSON.parse(localStorage.getItem('waze_places_offline_pousos') || '[]').map((e) => e[0]); } catch (e) { return []; } });
diz('COM rede, o ✕ pousou no Waze e ficou gravado como pouso DEPOIS da fila guardada',
  decisoes9b.length === 1 && decisoes9b[0].chave === k101 && pousos9b.includes(k101),
  JSON.stringify({ k101, decisoes9b, pousos9b }));
// A página de antes sai de cena: viva, ela também esvaziaria a fila de saída
// quando a rede voltasse, e a medição somaria duas páginas.
await page.goto('about:blank');

const abrirFria9b = async (nome) => {
  const fria = await ctx.newPage();
  fria.on('pageerror', (e) => errosJs.push({ secao: secaoAtual + ` [${nome}]`, txt: String(e.message) }));
  fria.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text()))
    violacoes.push({ secao: secaoAtual + ` [${nome}]`, txt: m.text() }); });
  await fria.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  return fria;
};
const estadoDaFila9b = (pg) => pg.evaluate(async () => {
  const k = (p) => (p ? p.venueID + '|' + p.updateRequestID : null);
  return {
  onLine: navigator.onLine,
  fila: AppState.queue.map(k),
  frente: k(AppState.currentPlace),
  restam: AppState.serverTotal,
  abriu: dfatoAnel.filter((e) => e.k === 'offline.abriu').map((e) => ({ n: e.n, excluidos: e.excluidos })),
  guardada: ((await offlineLerFila()) || {}).places?.length,
  alertas: diagSentinelas(diagComputado()).map((a) => a.chave),
  };
});

// 2. Avião, e o app REABERTO: o ✕ dado com rede não volta.
aviao = true; await ctx.setOffline(true);
const p1 = await abrirFria9b('reaberta 1');
await esperarNaPagina(p1, () => typeof dfatoAnel !== 'undefined' && dfatoAnel.some((e) => e.k === 'offline.abriu'), 20000, 100);
const r1 = await estadoDaFila9b(p1);
diz('CONTROLE: a fila guardada continua com os 5 — a foto é de ANTES do ✕, então quem tira é o filtro',
  r1.guardada === 5, JSON.stringify(r1));
diz('reaberta sem rede, o pedido tratado COM rede depois da foto NÃO volta',
  r1.onLine === false && r1.fila.length === 4 && !r1.fila.includes(k101) && r1.restam === 4
  && r1.abriu.at(-1)?.n === 4 && r1.abriu.at(-1)?.excluidos === 1, JSON.stringify(r1));

// 3. Sem rede: dois pedidos tratados vão pra fila de saída, e um terceiro fica
//    na janela do Desfazer quando o app é FECHADO.
const k1 = await decidir9b(p1, '.card-btn-reject', true);
const k2 = await decidir9b(p1, '.card-btn-read', true);
await p1.evaluate(() => { AppState.preferences.undoEnabled = true; });
const k3 = await p1.evaluate(() => (AppState.currentPlace ? AppState.currentPlace.venueID + '|' + AppState.currentPlace.updateRequestID : null));
await p1.evaluate(() => cardDaFrente().querySelector('.card-btn-reject').click());
// O clique passa pela animação do `triggerSwipe` (~350ms) ANTES de agendar a
// ação: fechar antes disso é fechar sem decisão nenhuma, e mediria o nada.
// Sinal POSITIVO: a ação está na janela.
await esperarNaPagina(p1, () => !!AppState.pendingAction, 5000, 50);
const naJanela = await p1.evaluate(() => { const p = AppState.pendingAction && AppState.pendingAction.place;
  return p ? p.venueID + '|' + p.updateRequestID : null; });
diz('PRÉ-CONDIÇÃO: o terceiro ✕ está na JANELA do Desfazer quando o app é fechado',
  naJanela === k3 && !!k3, JSON.stringify({ naJanela, k3 }));
// Fechar COMO O USUÁRIO FECHA: com `pagehide` e `visibilitychange`, que é o
// que o aparelho dispara ao sair do app. O `close()` puro muda de semântica
// entre as versões — MEDIDO: no Playwright 1.49 (o do CI, Chromium 131) ele
// destrói a página SEM disparar nenhum dos dois; no 1.56 (o do sandbox)
// dispara. Sem o `runBeforeUnload`, esta asserção passava aqui e reprovava no
// CI por motivo de instrumento.
await p1.close({ runBeforeUnload: true });

// 4. Reaberta de novo, sem rede: nada do que foi decidido volta.
const p2 = await abrirFria9b('reaberta 2');
await esperarNaPagina(p2, () => typeof dfatoAnel !== 'undefined' && dfatoAnel.some((e) => e.k === 'offline.abriu'), 20000, 100);
const r2 = await estadoDaFila9b(p2);
const s2 = await saida9b(p2);
diz('a ação que estava na janela do Desfazer ao FECHAR sem rede foi pra fila de saída (nada se perdeu)',
  Array.isArray(s2) && s2.some((x) => x.chave === k3), JSON.stringify({ k3, s2 }));
diz('a fila de saída tem as TRÊS decisões, uma vez cada',
  Array.isArray(s2) && s2.length === 3 && new Set(s2.map((x) => x.chave)).size === 3
  && [k1, k2, k3].every((k) => s2.some((x) => x.chave === k)), JSON.stringify(s2));
diz('reaberta de novo, NENHUM pedido decidido volta como card (o relato)',
  r2.onLine === false && r2.fila.length === 1 && ![k101, k1, k2, k3].some((k) => r2.fila.includes(k))
  && r2.restam === 1 && r2.abriu.at(-1)?.excluidos === 4, JSON.stringify(r2));
diz('e o relatório não acusa pedido decidido na fila', !r2.alertas.includes('pedidoDecididoNaFila'),
  JSON.stringify(r2.alertas));
// CONTROLE da sentinela: o pedido que está na tela, posto na fila de saída,
// tem que ser ACUSADO — senão "não acusa" passaria por vácuo.
const controle9b = await p2.evaluate(() => {
  const cru = localStorage.getItem('waze_places_saida');
  const f = JSON.parse(cru || '[]');
  const p = AppState.currentPlace;
  f.push({ tipo: 'read', venueID: p.venueID, updateRequestID: p.updateRequestID, t: Date.now() });
  localStorage.setItem('waze_places_saida', JSON.stringify(f));
  const alertas = diagSentinelas(diagComputado()).map((a) => a.chave);
  localStorage.setItem('waze_places_saida', cru);
  return alertas;
});
diz('CONTROLE: com um pedido da fila de saída na tela, a sentinela ACUSA',
  controle9b.includes('pedidoDecididoNaFila'), JSON.stringify(controle9b));

// 5. O último, e a rede volta: sai UMA decisão por pedido, e o placar e o
//    histórico contam cada uma UMA vez.
const k4 = await decidir9b(p2, '.card-btn-read', true);
aviao = false; await ctx.setOffline(false);
await p2.evaluate(() => window.dispatchEvent(new Event('online')));
let rodadas9b = 0;
for (; rodadas9b < 6; rodadas9b++) {
  await esperarFimDaSaida(p2, 25000);
  const resta = (await saida9b(p2) || []).length;
  if (resta === 0) break;
  await p2.evaluate(() => window.dispatchEvent(new Event('online')));
  await dormir(400);
}
const chegaram = decisoes9b.map((d) => d.chave);
const final9b = await p2.evaluate(() => JSON.parse(localStorage.getItem('waze_places_stats') || '{}'));
const histDepois9b = await historico9b(p2);
console.log(`  · 9b [esvaziamento] rodadas=${rodadas9b + 1}`);
diz('a rede voltou e cada pedido recebeu UMA decisão — nenhum repetido no Waze',
  chegaram.length === 5 && new Set(chegaram).size === 5
  && [k101, k1, k2, k3, k4].every((k) => chegaram.includes(k)), JSON.stringify(chegaram));
// O placar conta GESTOS, e o que ele promete é contar PEDIDOS: com o defeito,
// cinco gestos caíam em dois pedidos (o mesmo card voltando) e o número batia
// com os gestos — medido na main de antes, 202/3 com só DOIS pedidos decididos.
// Por isso a conta é contra os pedidos DISTINTOS que chegaram ao Waze.
const distintos9b = new Set(chegaram).size;
diz('o placar contou cada PEDIDO uma vez — 5 decididos, 5 no placar (3 ✕ e 2 ✓)',
  final9b.rejected === 3 && final9b.read === 202 && distintos9b === 5
  && (final9b.rejected + final9b.read - 200) === distintos9b, JSON.stringify({ final9b, distintos9b }));
const dHist9b = { read: histDepois9b?.read - histAntes9b?.read, rejected: histDepois9b?.rejected - histAntes9b?.rejected };
diz('e o histórico também (cada pouso é um pedido)',
  dHist9b.rejected === 3 && dHist9b.read === 2 && dHist9b.rejected + dHist9b.read === distintos9b,
  JSON.stringify({ histAntes9b, histDepois9b, distintos9b }));
await p2.close();

// 6. A reabertura COM rede e a fila de saída ainda cheia: a busca corre junto
//    do esvaziamento. O "Waze" tira a lista NA CHEGADA da busca e responde
//    1,5s depois; nesse meio, a 1ª decisão POUSA (100ms) e a 2ª continua no ar
//    (4s). As duas estavam na lista, e nenhuma pode virar card.
for (const i of [106, 107, 108]) pendentes9b.set(chave9b(SO_MAPA(i)), SO_MAPA(i));
aviao = true; await ctx.setOffline(true);
const prep = await abrirFria9b('preparo 6');
await esperarNaPagina(prep, () => typeof enfileirarSaida === 'function', 20000, 100);
await prep.evaluate((ps) => { enfileirarSaida('reject', ps[0]); enfileirarSaida('read', ps[1]); },
  [SO_MAPA(106), SO_MAPA(107)]);
await prep.close();
const k106 = chave9b(SO_MAPA(106));
const k107 = chave9b(SO_MAPA(107));
atrasoBusca9b = 1500;
atrasoDecisao9b = (k) => (k === k106 ? 100 : 4000);
aviao = false; await ctx.setOffline(false);
const p3 = await abrirFria9b('reaberta com rede');
await esperarNaPagina(p3, () => typeof dfatoAnel !== 'undefined' && dfatoAnel.some((e) => e.k === 'tela.primeiroCard'), 20000, 100);
const r3 = await p3.evaluate(() => ({ fila: AppState.queue.map((p) => p.venueID + '|' + p.updateRequestID), restam: AppState.serverTotal,
  jaDecididos: dfatoAnel.filter((e) => e.k === 'busca.jaDecididos').map((e) => e.n) }));
const b3 = buscas9b.at(-1);
const d106 = decisoes9b.find((d) => d.chave === k106);
diz('PRÉ-CONDIÇÃO: a lista da busca tinha os dois; a 1ª decisão pousou DEPOIS de ela ser tirada e ANTES da resposta, e a 2ª ainda estava no ar',
  !!b3 && b3.lista.includes(k106) && b3.lista.includes(k107) && !!d106
  && d106.t >= b3.tPedido && d106.t <= b3.tResposta && !decisoes9b.some((d) => d.chave === k107 && d.t <= b3.tResposta),
  JSON.stringify({ b3, d106 }));
diz('reaberta COM rede, nem o que pousou no meio da busca nem o que está saindo vira card',
  r3.fila.length === 1 && r3.fila[0] === chave9b(SO_MAPA(108)) && r3.restam === 1
  && r3.jaDecididos.includes(2), JSON.stringify(r3));
for (let j = 0; j < 80 && !decisoes9b.some((d) => d.chave === k107); j++) await dormir(100);
await esperarFimDaSaida(p3, 25000);
diz('e as duas decisões saíram uma vez cada',
  decisoes9b.filter((d) => d.chave === k106).length === 1 && decisoes9b.filter((d) => d.chave === k107).length === 1,
  JSON.stringify(decisoes9b.map((d) => d.chave)));
await p3.evaluate(() => { API.setSession(null); });
await p3.close();
atrasoBusca9b = 0;
atrasoDecisao9b = () => 0;

// 7. A FILA GUARDADA TERMINADA SEM REDE. Reaberta sem rede, ela voltava com
//    `hasMore = false`, e terminá-la mostrava "Tudo limpo!" — com pedido ainda
//    pendente no Waze, e mesmo com a rede de volta, porque nada mais buscava.
//    A tela certa é a de "sem conexão" ("os pedidos voltam sozinhos quando a
//    rede voltar"), e é o que a volta da rede tem que cumprir: aqui, trazendo
//    um pedido que CHEGOU enquanto a pessoa tratava sem sinal.
for (const i of [111, 112, 113]) pendentes9b.set(chave9b(SO_MAPA(i)), SO_MAPA(i));
const p4 = await abrirFria9b('preparo 7');
await esperarNaPagina(p4, () => typeof API !== 'undefined', 20000, 100);
await p4.evaluate(() => { API.setSession('tok-9b'); });
await p4.reload({ waitUntil: 'domcontentloaded' });
await esperarNaPagina(p4, () => typeof AppState !== 'undefined' && AppState.queue.length === 4, 20000, 100);
await p4.evaluate(() => { offlineJanelaServida = null; offlineUltimoResultado = null;
  offlineMarcarGesto(); offlineVarrer(); });
await esperarNaPagina(p4, () => offlineUltimoResultado !== null, 60000, 250);
const foto7 = await p4.evaluate(async () => ({ res: offlineUltimoResultado, n: ((await offlineLerFila()) || {}).places?.length }));
await p4.close();
diz('7: PRÉ-CONDIÇÃO — com rede, a fila guardada tem os 4 pendentes', foto7.res === 'pronto' && foto7.n === 4,
  JSON.stringify(foto7));
aviao = true; await ctx.setOffline(true);
const p5 = await abrirFria9b('reaberta 7');
await esperarNaPagina(p5, () => typeof dfatoAnel !== 'undefined' && dfatoAnel.some((e) => e.k === 'offline.abriu'), 20000, 100);
const r5 = await p5.evaluate(() => ({ fila: AppState.queue.length, hasMore: AppState.hasMore }));
pendentes9b.set(chave9b(SO_MAPA(114)), SO_MAPA(114));        // chega enquanto a pessoa está sem rede
for (let i = 0; i < 4; i++) await decidir9b(p5, '.card-btn-reject', true);
await dormir(300);
const tela7 = await p5.evaluate(() => {
  const aberto = (id) => !document.getElementById(id).classList.contains('hidden');
  return { fila: AppState.queue.length, limpo: aberto('noMoreCards'), falha: aberto('loadErrorState'),
           saida: JSON.parse(localStorage.getItem('waze_places_saida') || '[]').length };
});
diz('7: reaberta sem rede, a fila guardada volta dizendo "pode haver mais" — não "acabou"',
  r5.fila === 4 && r5.hasMore === true, JSON.stringify(r5));
diz('7: terminada SEM REDE, a tela é a de "sem conexão", nunca o "Tudo limpo!"',
  tela7.fila === 0 && tela7.falha && !tela7.limpo && tela7.saida === 4, JSON.stringify(tela7));
const k114 = chave9b(SO_MAPA(114));
aviao = false; await ctx.setOffline(false);
const chegou7 = await esperarNaPagina(p5, () => {
  const p = AppState.currentPlace;
  return !!p && AppState.queue.length === 1 && AppState.inFlightActions === 0;
}, 25000, 200);
const depois7 = await estadoDaFila9b(p5);
diz('7: a rede de volta manda as 4 decisões e traz SOZINHA o pedido que chegou sem sinal',
  chegou7.ok && depois7.frente === k114
  && [111, 112, 113, 108].every((i) => decisoes9b.filter((d) => d.chave === chave9b(SO_MAPA(i))).length === 1),
  JSON.stringify({ depois7, decisoes: decisoes9b.map((d) => d.chave) }));
// 8. PULOU TUDO SEM REDE e a rede voltou: os pulados VOLTAM. Pular não decide
// nada — e sem sinal é o que sobra pro card de foto cuja foto não veio. Com a
// fila vazia (a tela de "sem conexão"), a volta da rede é um ATUALIZAR. Uma
// correção desta mesma auditoria a trocou por "só retomar", e a fila terminava
// VAZIA com os pedidos pendentes — achado pela auditoria EM PRODUÇÃO
// (2026-09-25), exatamente neste caminho: o app REABERTO sem rede (que abre
// dizendo "pode haver mais"), tudo pulado, a rede de volta. Este smoke não o
// tinha. A página de antes sai de cena SEM apagar a sessão (é a mesma pra
// página nova), senão o `online` dela somaria.
await p5.goto('about:blank');
aviao = true; await ctx.setOffline(true);
const p6 = await abrirFria9b('reaberta 6');
await esperarNaPagina(p6, () => typeof dfatoAnel !== 'undefined' && dfatoAnel.some((e) => e.k === 'offline.abriu'), 20000, 100);
const pulados8 = [];
for (let j = 0; j < 8; j++) {
  const antes = await p6.evaluate(() => ({ n: AppState.queue.length, k: AppState.currentPlace
    ? AppState.currentPlace.venueID + '|' + AppState.currentPlace.updateRequestID : null }));
  if (!antes.n || !antes.k) break;
  await p6.evaluate(() => cardDaFrente().querySelector('.card-btn-skip').click());
  for (let t = 0; t < 50; t++) { if ((await p6.evaluate(() => AppState.queue.length)) < antes.n) break; await dormir(100); }
  pulados8.push(antes.k);
}
const semConexao8 = await esperarNaPagina(p6, () => !document.getElementById('loadErrorState').classList.contains('hidden'), 10000, 100);
diz('8: PRÉ-CONDIÇÃO — reaberto sem rede e pulado tudo, a tela é a de "sem conexão"',
  pulados8.length > 0 && semConexao8.ok, JSON.stringify({ pulados8, semConexao8 }));
aviao = false; await ctx.setOffline(false);
const voltou8 = await esperarNaPagina(p6, () => AppState.queue.length > 0 && !!cardDaFrente(), 25000, 200);
const depois8 = await estadoDaFila9b(p6);
diz('8: a rede de volta traz de volta os PULADOS sem sinal (a fila não termina vazia com pedido pendente)',
  voltou8.ok && pulados8.every((k) => depois8.fila.includes(k)), JSON.stringify({ pulados8, depois8 }));
await p6.evaluate(() => { API.setSession(null); });
await p6.close();
await p5.close();

// 9. LIE-FI AO FECHAR: o ✕ está na janela do Desfazer, o app é fechado com o
//    rádio dizendo `onLine` e nada passando. A descarga gravava o POUSO antes do
//    envio `keepalive`; o envio morria e a decisão SUMIA — a reabertura sem rede
//    escondia o pedido (o pouso) e o placar ficava +1, sem nada na fila de saída
//    (auditoria de 2026-09-26, O5; medido na main de antes: fila de saída vazia e
//    o Waze sem a decisão). Agora ela entra na fila de saída ANTES do envio.
for (const i of [121, 122, 123]) pendentes9b.set(chave9b(SO_MAPA(i)), SO_MAPA(i));
aviao = false; await ctx.setOffline(false);
const p7 = await abrirFria9b('preparo 9');
await esperarNaPagina(p7, () => typeof API !== 'undefined', 20000, 100);
await p7.evaluate(() => { API.setSession('tok-9b'); });
await p7.reload({ waitUntil: 'domcontentloaded' });
await esperarNaPagina(p7, () => typeof AppState !== 'undefined' && AppState.queue.length >= 3 && !!cardDaFrente(), 20000, 100);
await p7.evaluate(() => { offlineJanelaServida = null; offlineUltimoResultado = null;
  offlineMarcarGesto(); offlineVarrer(); });
await esperarNaPagina(p7, () => offlineUltimoResultado !== null, 60000, 250);
const rejeitados9 = await p7.evaluate(() => AppState.stats.rejected);
await p7.evaluate(() => { AppState.preferences.undoEnabled = true; });
await p7.evaluate(() => cardDaFrente().querySelector('.card-btn-reject').click());
await esperarNaPagina(p7, () => !!AppState.pendingAction, 5000, 50);
const k9 = await p7.evaluate(() => { const p = AppState.pendingAction && AppState.pendingAction.place;
  return p ? p.venueID + '|' + p.updateRequestID : null; });
diz('9: PRÉ-CONDIÇÃO — o ✕ está na JANELA do Desfazer quando o app é fechado, e a preparação ficou pronta',
  !!k9 && (await p7.evaluate(() => offlineUltimoResultado)) === 'pronto', JSON.stringify({ k9 }));
lieFi9b = true;
await p7.close({ runBeforeUnload: true });
await dormir(500);
lieFi9b = false;
aviao = true; await ctx.setOffline(true);
const p8 = await abrirFria9b('reaberta lie-fi');
await esperarNaPagina(p8, () => typeof dfatoAnel !== 'undefined' && dfatoAnel.some((e) => e.k === 'offline.abriu'), 20000, 100);
const r9 = await estadoDaFila9b(p8);
const s9 = await saida9b(p8);
const pousos9 = await p8.evaluate(() => { try {
  return JSON.parse(localStorage.getItem('waze_places_offline_pousos') || '[]').map((e) => e[0]); } catch (e) { return []; } });
diz('9: a decisão do envio que MORREU está na fila de saída (nada se perdeu)',
  Array.isArray(s9) && s9.filter((x) => x.chave === k9).length === 1, JSON.stringify({ k9, s9 }));
diz('9: e o pedido não volta como card — quem o esconde é a fila de saída, não um pouso sem resposta',
  !r9.fila.includes(k9) && !pousos9.includes(k9), JSON.stringify({ k9, fila: r9.fila, pousos9 }));
aviao = false; await ctx.setOffline(false);
await p8.evaluate(() => window.dispatchEvent(new Event('online')));
for (let j = 0; j < 6; j++) {
  await esperarFimDaSaida(p8, 25000);
  if (!(await saida9b(p8) || []).length) break;
  await p8.evaluate(() => window.dispatchEvent(new Event('online')));
  await dormir(400);
}
const final9 = await p8.evaluate(() => JSON.parse(localStorage.getItem('waze_places_stats') || '{}'));
diz('9: a rede de volta manda a decisão UMA vez, e o placar a conta UMA vez',
  decisoes9b.filter((d) => d.chave === k9).length === 1 && final9.rejected === rejeitados9 + 1,
  JSON.stringify({ decisoes: decisoes9b.filter((d) => d.chave === k9), rejeitados9, final9 }));
await p8.evaluate(() => { API.setSession(null); });
await p8.close();
await ctx.unroute('**/api/*', rotaApi9b);

secao('9c. O DIAGNÓSTICO SOBREVIVE A FECHAR O APP — o número do botão e o relatório');
// O mesmo relato do 9b: "usei o FAB 2 vezes, fechei e abri a aplicação e o
// número sumiu do FAB". Capturas, diário, chamadas e erros viviam só em
// MEMÓRIA — e o defeito daquele dia só existia atravessando um fechar e
// reabrir, então a prova de antes de fechar era justamente o que sumia.
//
// Aqui o botão é tocado DE VERDADE (toque do DevTools Protocol, num contexto
// com toque — o mesmo jeito do bloco do FAB no smoke de layout), o app é
// fechado como o usuário fecha, e o relatório é o de verdade, lido pelo leitor
// único. Contexto PRÓPRIO: armazenamento limpo, sem sobra das seções de cima.
// E cada regra de saída do que foi guardado é medida: baixar, 24 h, desligar o
// modo dev e o Sair — e o modo dev desligado não cria nada no aparelho.
const ctx9c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR',
  hasTouch: true, isMobile: true, serviceWorkers: 'block' });
const PEDIDOS_9C = [SO_MAPA(131), SO_MAPA(132)];
await ctx9c.route('**/*-tiles/live/base/**', servirTile);
await ctx9c.route('**/api/*', (r) => {
  const rota = r.request().url().split('/api/')[1];
  const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (rota === 'buscar-places') return json({ success: true, places: PEDIDOS_9C, hasMore: false, page: 1, total: PEDIDOS_9C.length });
  if (rota === 'perfil') return json({ success: true, profile: { id: 1, userName: 'e', rank: 5, isAreaManager: true, isStaff: false, editableCountryIDs: [30], areas: [] } });
  return r.abort('failed');   // presença, países, sessão: fora do que esta seção mede
});
const abrir9c = async (nome) => {
  const pg = await ctx9c.newPage();
  pg.on('pageerror', (e) => errosJs.push({ secao: secaoAtual + ` [${nome}]`, txt: String(e.message) }));
  pg.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text()))
    violacoes.push({ secao: secaoAtual + ` [${nome}]`, txt: m.text() }); });
  await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  return pg;
};
// A base do diagnóstico lida DE FORA, sem criá-la (só abre se ela existe).
const guardado9c = (pg) => pg.evaluate(async () => {
  const existe = (await indexedDB.databases()).some((d) => d.name === 'waze_places_diag');
  if (!existe) return { existe: false, abertas: [] };
  return await new Promise((ok) => {
    const req = indexedDB.open('waze_places_diag');
    req.onerror = () => ok({ existe: true, erro: 'abrir' });
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('aberturas')) { db.close(); return ok({ existe: true, abertas: [] }); }
      const r = db.transaction('aberturas').objectStore('aberturas').getAll();
      r.onsuccess = () => { db.close(); ok({ existe: true, abertas: r.result.map((a) => ({ id: a.id,
        capturas: (a.momentos || []).length, manuais: (a.momentos || []).filter((m) => m.motivo === 'manual').length,
        alertas: (a.momentos || []).flatMap((m) => (m.alertas || []).map((x) => x.chave)),
        comCorpo: (a.chamadas || []).some((c) => 'corpoReq' in c || 'corpoResposta' in c),
        salvoPor: a.salvoPor })) }); };
      r.onerror = () => { db.close(); ok({ existe: true, erro: 'ler' }); };
    };
  });
});
const selo9c = (pg) => pg.evaluate(() => { const s = document.getElementById('devFabBadge');
  return { txt: s.textContent.trim(), visivel: !s.classList.contains('hidden') }; });
// Toque de VERDADE no botão, e espera o RESULTADO (o anel crescer). Antes,
// espera o botão PARAR: logo depois de abrir, ele se reposiciona quando o card
// assenta (`posicionarFabDev` escolhe o canto pelo que está na tela), e o toque
// calculado no lugar velho cai fora dele — foi o que fez o primeiro toque de
// cada abertura sumir na primeira rodada desta seção.
const tocar9c = async (pg, cdp) => {
  let ultimo = '';
  for (let j = 0, parado = 0; j < 60 && parado < 3; j++) {
    const agora = await pg.evaluate(() => { const f = document.getElementById('devFab');
      const b = f.getBoundingClientRect();
      return f.classList.contains('hidden') ? 'escondido' : `${Math.round(b.left)},${Math.round(b.top)}`; });
    parado = agora !== 'escondido' && agora === ultimo ? parado + 1 : 0;
    ultimo = agora;
    await dormir(100);
  }
  const antes = await pg.evaluate(() => dlogMomentos.length);
  const c = await pg.evaluate(() => { const b = document.getElementById('devFab').getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
  await dormir(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  for (let j = 0; j < 50 && (await pg.evaluate(() => dlogMomentos.length)) <= antes; j++) await dormir(100);
  return (await pg.evaluate(() => dlogMomentos.length)) > antes;
};
const pronta9c = (pg) => esperarNaPagina(pg, () => typeof dfatoAnel !== 'undefined'
  && dfatoAnel.some((e) => e.k === 'tela.primeiroCard'), 20000, 100);
const carregou9c = (pg) => esperarNaPagina(pg, () => typeof dfatoAnel !== 'undefined'
  && dfatoAnel.some((e) => e.k === 'diag.aberturas'), 20000, 100);
// Ir pro FUNDO sem descarregar a página — o que o celular faz quando a pessoa
// troca de app ou abre os recentes. No headless a página nunca fica oculta sem
// ser descarregada, e descarregar ABORTA o IndexedDB em voo: MEDIDO, duas
// sabotagens ("guarda a captura já baixada" e "grava sem o modo dev") passavam
// limpas porque a gravação do fechar nunca terminava, com ou sem elas. Aqui o
// `visibilityState` vira "hidden", o evento sai, e o ouvinte DO APP roda com a
// página viva; depois espera a fila de gravações terminar e volta ao visível.
const irProFundo9c = async (pg) => {
  await pg.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await pg.evaluate(() => (typeof diagGuardando !== 'undefined' ? diagGuardando : null));
  await pg.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
};
// Espera o registro DESTA abertura ter `n` capturas guardadas.
const guardouNesta9c = (pg, n) => esperarNaPagina(pg, async () => { try {
  const db = await new Promise((ok, err) => { const r = indexedDB.open('waze_places_diag'); r.onsuccess = () => ok(r.result); r.onerror = err; });
  const todas = await new Promise((ok) => { const r = db.transaction('aberturas').objectStore('aberturas').getAll(); r.onsuccess = () => ok(r.result); });
  db.close();
  return todas.some((a) => a.id === DIAG_ABERTURA.id && (a.momentos || []).length === n);
} catch (e) { return false; } }, 10000, 100);

// 0. Sessão, e o modo dev DESLIGADO: fechar o app não pode criar nada.
const prep9c = await abrir9c('preparo');
await esperarNaPagina(prep9c, () => typeof API !== 'undefined', 20000, 100);
await prep9c.evaluate(() => {
  API.setSession('tok-9c');
  localStorage.setItem('waze_places_devmode', JSON.stringify({ unlocked: true, active: false }));
  localStorage.setItem('waze_places_preferences', JSON.stringify({ comoFuncionaVisto: true, undoEnabled: true }));
});
await prep9c.close({ runBeforeUnload: true });
const semDev = await abrir9c('modo dev desligado');
await pronta9c(semDev);
await irProFundo9c(semDev);
const gSemDev = await guardado9c(semDev);
diz('com o modo dev DESLIGADO, abrir e ir pro fundo não cria nada no aparelho', gSemDev.existe === false, JSON.stringify(gSemDev));
await semDev.evaluate(() => localStorage.setItem('waze_places_devmode', JSON.stringify({ unlocked: true, active: true })));
await semDev.close({ runBeforeUnload: true });

// 1. Modo dev ligado: dois toques no botão — um com a tela sã e outro com um
//    DEFEITO na tela (o pedido da frente posto na fila de saída, que a
//    sentinela do 9b acusa) —, e o app é fechado.
const p1d = await abrir9c('abertura 1');
await pronta9c(p1d);
await carregou9c(p1d);
const cdp1d = await ctx9c.newCDPSession(p1d);
const id1d = await p1d.evaluate(() => DIAG_ABERTURA.id);
const tocou1 = await tocar9c(p1d, cdp1d);
await p1d.evaluate(() => { const p = AppState.currentPlace; localStorage.setItem('waze_places_saida',
  JSON.stringify([{ tipo: 'read', venueID: p.venueID, updateRequestID: p.updateRequestID, t: Date.now() }])); });
const tocou2 = await tocar9c(p1d, cdp1d);
await p1d.evaluate(() => localStorage.removeItem('waze_places_saida'));
diz('PRÉ-CONDIÇÃO: os dois toques no botão viraram capturas', tocou1 && tocou2, `${tocou1} ${tocou2}`);
await esperarNaPagina(p1d, async () => { try {
  const db = await new Promise((ok, err) => { const r = indexedDB.open('waze_places_diag'); r.onsuccess = () => ok(r.result); r.onerror = err; });
  const todas = await new Promise((ok) => { const r = db.transaction('aberturas').objectStore('aberturas').getAll(); r.onsuccess = () => ok(r.result); });
  db.close();
  return todas.some((a) => a.id === DIAG_ABERTURA.id && (a.momentos || []).length === 2);
} catch (e) { return false; } }, 10000, 100);
const g1d = await guardado9c(p1d);
const s1d = await selo9c(p1d);
diz('a captura vai pro aparelho NA HORA, e o número do botão mostra 2',
  s1d.txt === '2' && s1d.visivel && g1d.abertas.some((a) => a.id === id1d && a.manuais === 2),
  JSON.stringify({ s1d, g1d }));
diz('a captura do defeito ACUSA a sentinela, e o guardado leva a acusação',
  g1d.abertas.some((a) => a.id === id1d && a.alertas.includes('pedidoDecididoNaFila')), JSON.stringify(g1d));
diz('as chamadas vão pro aparelho SEM corpo', g1d.abertas.every((a) => !a.comCorpo), JSON.stringify(g1d));
// Como no aparelho: o app vai pro fundo (os recentes) e depois é fechado.
await irProFundo9c(p1d);
await p1d.close({ runBeforeUnload: true });

// 2. Reaberta: o número volta, e o relatório de verdade leva a abertura anterior.
const p2d = await abrir9c('abertura 2');
await pronta9c(p2d);
await carregou9c(p2d);
const r2d = await p2d.evaluate(() => ({ desta: dlogMomentos.length, id: DIAG_ABERTURA.id,
  anteriores: diagAberturasAnteriores.map((a) => ({ id: a.id, n: (a.momentos || []).length })) }));
const s2d = await selo9c(p2d);
diz('REABERTA, o número do botão continua 2 — o relato',
  s2d.txt === '2' && s2d.visivel, JSON.stringify({ s2d, r2d }));
diz('CONTROLE: nenhuma captura NESTA abertura — as 2 vieram do aparelho, da abertura anterior',
  r2d.desta === 0 && r2d.anteriores.length === 1 && r2d.anteriores[0].id === id1d && r2d.anteriores[0].n === 2,
  JSON.stringify(r2d));
const cdp2d = await ctx9c.newCDPSession(p2d);
await tocar9c(p2d, cdp2d);
const s3d = await selo9c(p2d);
diz('uma captura nova soma às guardadas: 3', s3d.txt === '3', JSON.stringify(s3d));
let rel9c = null;
const dir9c = mkdtempSync(join(tmpdir(), 'diag-9c-'));
try {
  const [dl] = await Promise.all([
    p2d.waitForEvent('download', { timeout: 30000 }),
    p2d.evaluate(() => baixarDiagnostico()),
  ]);
  const arq = join(dir9c, 'diag.zip');
  await dl.saveAs(arq);
  const { dados: d } = lerDiagnostico(arq);
  const triagem = execFileSync(process.execPath, [join(ROOT, 'tools/diag-resumo.mjs'), arq], { encoding: 'utf8', timeout: 20000 });
  const ant = (d.aberturasAnteriores || [])[0] || {};
  rel9c = {
    n: (d.aberturasAnteriores || []).length, id: ant.id, capturas: (ant.momentos || []).length,
    comDom: (ant.momentos || []).every((m) => typeof m.dom === 'string' && m.dom.length > 1000),
    diario: (ant.diario || []).length, semCorpo: (ant.chamadas || []).every((c) => !('corpoReq' in c) && !('corpoResposta' in c)),
    atual: d.aberturaAtual && d.aberturaAtual.id, resumo: d.resumo && d.resumo.aberturasAnteriores,
    alertaAnterior: (d.resumo?.alertasNasCapturas || []).some((c) => c.abertura === id1d && c.alertas.includes('pedidoDecididoNaFila')),
    triagemSecao: triagem.includes('ABERTURAS ANTERIORES') && triagem.includes('abertura ' + id1d),
    triagemAlerta: triagem.includes('[abertura anterior ' + id1d + ']'),
    vazouToken: triagem.includes('tok-9c'),
  };
} catch (e) {
  rel9c = { erro: String((e && e.message) || e).slice(0, 200) };
} finally {
  rmSync(dir9c, { recursive: true, force: true });
}
diz('o RELATÓRIO leva a abertura anterior inteira: as 2 capturas (com o DOM), o diário, as chamadas sem corpo',
  rel9c?.n === 1 && rel9c?.id === id1d && rel9c?.capturas === 2 && rel9c?.comDom === true && rel9c?.diario > 0
  && rel9c?.semCorpo === true && rel9c?.atual === r2d.id && rel9c?.resumo?.n === 1 && rel9c?.resumo?.capturas === 2,
  JSON.stringify(rel9c));
diz('o resumo e o leitor mostram o defeito capturado ANTES de fechar, dizendo de qual abertura — sem o token',
  rel9c?.alertaAnterior === true && rel9c?.triagemSecao === true && rel9c?.triagemAlerta === true && rel9c?.vazouToken === false,
  JSON.stringify(rel9c));
const apagou = await esperarNaPagina(p2d, async () => !(await indexedDB.databases()).some((d) => d.name === 'waze_places_diag'), 10000, 100);
const s4d = await selo9c(p2d);
diz('BAIXADO, o que estava guardado sai do aparelho (e nesta abertura o número segue contando, como sempre)',
  apagou.ok && s4d.txt === '3', JSON.stringify({ apagou, s4d }));
// Segue usando depois do download: uma captura NOVA, e o app vai pro fundo.
// É o caso que separa "guardar o que não foi entregue" de "guardar tudo": com
// o anel desta abertura tendo uma baixada e uma nova, só a nova pode voltar.
const tBaixado = await p2d.evaluate(() => diagBaixadoEm);
const tocouPos = await tocar9c(p2d, cdp2d);
await guardouNesta9c(p2d, 1);
await irProFundo9c(p2d);
await p2d.close({ runBeforeUnload: true });

// 3. Reaberta depois do download: o que foi entregue não volta.
const p3d = await abrir9c('abertura 3');
await pronta9c(p3d);
await carregou9c(p3d);
const r3d = await p3d.evaluate((tb) => ({ capturas: diagMomentosAnteriores().length,
  manuais: diagCapturasAnterioresDoEditor().length,
  diarioAntes: diagAberturasAnteriores.flatMap((a) => a.diario || []).filter((e) => e.t <= tb).length }), tBaixado);
const s5d = await selo9c(p3d);
diz('o que foi BAIXADO não volta: reaberta, só a captura feita DEPOIS do download volta — e o diário de antes dele também não',
  tocouPos && r3d.capturas === 1 && r3d.manuais === 1 && r3d.diarioAntes === 0 && s5d.txt === '1',
  JSON.stringify({ tocouPos, r3d, s5d }));

// 4. O prazo de 24 h: uma abertura guardada de 25 h atrás sai; a de 23 h fica.
await p3d.evaluate(() => new Promise((ok) => {
  const req = indexedDB.open('waze_places_diag', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('aberturas', { keyPath: 'id' });
  req.onsuccess = () => {
    const db = req.result; const h = 3600e3; const agora = Date.now();
    const tx = db.transaction('aberturas', 'readwrite'); const st = tx.objectStore('aberturas');
    const cap = () => [{ t: new Date().toISOString(), motivo: 'manual', alertas: [] }];
    st.put({ id: 'velha', inicio: agora - 26 * h, salvoEm: agora - 25 * h, salvoPor: 'oculta', momentos: cap(), diario: [], chamadas: [], erros: [] });
    st.put({ id: 'fresca', inicio: agora - 24 * h, salvoEm: agora - 23 * h, salvoPor: 'oculta', momentos: cap(), diario: [], chamadas: [], erros: [] });
    tx.oncomplete = () => { db.close(); ok(); };
  };
}));
await p3d.close({ runBeforeUnload: true });
const p4d = await abrir9c('abertura 4');
await pronta9c(p4d);
await carregou9c(p4d);
const r4d = await p4d.evaluate(() => diagAberturasAnteriores.map((a) => a.id));
const g4d = await guardado9c(p4d);
const s6d = await selo9c(p4d);
// O número: a captura pós-download da abertura 2 + a da "fresca" = 2.
diz('a abertura guardada há MAIS de 24 h sai do aparelho; a de 23 h fica, com a captura contando no número',
  !r4d.includes('velha') && r4d.includes('fresca') && !g4d.abertas.some((a) => a.id === 'velha') && s6d.txt === '2',
  JSON.stringify({ r4d, g4d, s6d }));

// 5. Desligar o modo dev apaga o que ficou guardado — mas com captura NÃO
// baixada o 1º toque só AVISA e devolve o interruptor (auditoria de 2026-09-25:
// o aviso "baixe antes de desligar" saía no mesmo tique do apagamento, quando
// já não havia o que baixar). O 2º toque, dentro de 15 s, desliga e apaga.
const naoBaixadas = await p4d.evaluate(() => dlogNaoBaixados());
const desligar9c = () => p4d.evaluate(() => { const cb = document.getElementById('prefDevModeActive');
  cb.checked = false; cb.dispatchEvent(new Event('change')); return cb.checked; });
const marcadoDepoisDo1o = await desligar9c();
await dormir(300);
const r5a = await p4d.evaluate(async () => ({ memoria: diagAberturasAnteriores.length,
  ativo: AppState.devMode.active, base: (await indexedDB.databases()).some((d) => d.name === 'waze_places_diag') }));
diz('com captura NÃO baixada, o 1º toque em desligar só AVISA: o interruptor volta e nada é apagado',
  naoBaixadas === 2 && marcadoDepoisDo1o === true && r5a.ativo === true && r5a.memoria > 0 && r5a.base === true,
  JSON.stringify({ naoBaixadas, marcadoDepoisDo1o, r5a }));
await desligar9c();
const apagouDev = await esperarNaPagina(p4d, async () => !(await indexedDB.databases()).some((d) => d.name === 'waze_places_diag'), 10000, 100);
const r5d = await p4d.evaluate(() => ({ memoria: diagAberturasAnteriores.length,
  fab: document.getElementById('devFab').classList.contains('hidden') }));
diz('o 2º toque DESLIGA o modo dev e apaga o guardado — do aparelho e da memória',
  apagouDev.ok && r5d.memoria === 0 && r5d.fab === true, JSON.stringify({ apagouDev, r5d }));
await p4d.evaluate(() => localStorage.setItem('waze_places_devmode', JSON.stringify({ unlocked: true, active: true })));
await p4d.close({ runBeforeUnload: true });

// 6. O "Sair" leva o que foi guardado junto.
const p5d = await abrir9c('abertura 5');
await pronta9c(p5d);
await carregou9c(p5d);
const cdp5d = await ctx9c.newCDPSession(p5d);
const tocou5 = await tocar9c(p5d, cdp5d);
// Espera o REGISTRO com a captura, não a base existir: a base nasce vazia na
// própria abertura (a leitura do guardado a abre), então "existe" chegava antes
// da gravação e o guard lia uma lista vazia.
await esperarNaPagina(p5d, async () => { try {
  const db = await new Promise((ok, err) => { const r = indexedDB.open('waze_places_diag'); r.onsuccess = () => ok(r.result); r.onerror = err; });
  const todas = await new Promise((ok) => { const r = db.transaction('aberturas').objectStore('aberturas').getAll(); r.onsuccess = () => ok(r.result); });
  db.close();
  return todas.some((a) => a.id === DIAG_ABERTURA.id && (a.momentos || []).length === 1);
} catch (e) { return false; } }, 10000, 100);
const g5d = await guardado9c(p5d);
diz('PRÉ-CONDIÇÃO: o toque no botão da abertura 5 virou captura', tocou5, String(tocou5));
await p5d.evaluate(() => { handleLogout(); });
const apagouSair = await esperarNaPagina(p5d, async () => !(await indexedDB.databases()).some((d) => d.name === 'waze_places_diag'), 10000, 100);
diz('o SAIR apaga o que foi guardado (e a captura que ia pro próximo relatório)',
  g5d.abertas.some((a) => a.manuais === 1) && apagouSair.ok, JSON.stringify({ g5d, apagouSair }));
await p5d.close();
await ctx9c.close();

secao('10. NADA DE ERRO, NADA DE CSP');
diz('nenhum erro de JS em todo o percurso', errosJs.length === 0, JSON.stringify(errosJs.slice(0, 3)));
diz('nenhuma violação de CSP', violacoes.length === 0, JSON.stringify(violacoes.slice(0, 3)));

await browser.close();
servidor.kill();
if (falhas) {
  console.log(`\n✗ smoke do offline: ${falhas} falha(s)`);
  process.exit(1);
}
console.log('\n✓ smoke do offline: 17 seções (16 com o service worker LIGADO) — o MAPINHA DO CARD e o'
  + ' MAPA AMPLIADO desenhando tile (com contraprova que vai a zero), mapa intacto com o'
  + ' toggle desligado e com o cache cheio, fila em IndexedDB, sufixo da foto como contrato'
  + ' (app E card), varredura enchendo e servindo do cache sem rede, abertura offline,'
  + ' card de foto que AVISA quando a foto não veio e MOSTRA quando veio, a foto guardada sendo a'
  + ' EM DECISÃO (e o app reaberto sem rede achando-a — num contexto à parte, com o SW fora, pelo'
  + ' cache HTTP como no aparelho), A ESTRADA inteira (com pedidos DE FOTO) (encher, modo avião com foto e mapa vindo do cache, 6 ações enfileiradas e a rede voltando pra drenar), o reporte de caixa CURTA achando todos os tiles (com a troca de zoom como pré-condição), o service worker ENCERRADO acordando sabendo dos tiles (com controle de que foi mesmo encerrado), a preparação INTERROMPIDA deixando o mapa guardado visível (com controle de que foi parcial e de que o worker não renasceu), o DEPLOY não apagando o mapa provisionado (com o cache de versão velho sumindo como controle), o DIAGNÓSTICO enxergando o offline (rede no diário e na captura, seção offline, o worker respondendo por si, as duas sentinelas novas dos dois lados e o teto da lista de recursos com controle), esquecer PARANDO o download em voo, e o que foi TRATADO não voltando como card (decidir e reabrir sem rede em página nova, a ação na janela do Desfazer ao fechar, e a busca com rede correndo junto do esvaziamento — com a fila guardada intacta como controle)');
