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

import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as dormir } from 'node:timers/promises';
import { esperarFimDaSaida, esperarNaPagina } from './esperar-saida.mjs';
import { lerDiagnostico } from './diag-ler.mjs';
import { carregarPlaywright, abrirChromium } from './navegador.mjs';
import { subirServidorLocal } from './servidor-local.mjs';

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
// O servidor sobe por `tools/servidor-local.mjs` (fonte única): a porta tem
// que estar LIVRE antes, e pronto é o próprio processo dizer que a ocupou. Um
// processo esquecido na mesma porta sequestrava o teste em silêncio — o `spawn`
// morria com EADDRINUSE, a sonda de saúde passava com o VELHO, e o smoke media
// um servidor com outra chave (foi assim que a seção da sala, na época,
// reprovou por vácuo).
const { servidor } = await subirServidorLocal({ porta: PORTA, variavel: 'PORTA_OFFLINE', env: { ENCRYPTION_KEY: CHAVE_TESTE } });

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
// A contagem do resumo do fim sai daqui: escrita à mão, ela ficou em 20/21 com
// 26 seções no arquivo, e ninguém percebe número de resumo que não confere.
let secoesRodadas = 0;
const secao = (nome) => { secaoAtual = nome; secoesRodadas++; console.log(`\n\u2500\u2500 ${nome} \u2500\u2500`); };
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
// E a varredura da janela SEGUINTE vai à REDE pelos tiles já guardados: é a
// revalidação de cada janela (o servidor de tile responde 304 quando nada
// mudou). Respondida pelo worker a partir do próprio cache, ela nunca mais saía
// e o guardado ficava o da primeira vez pra sempre (auditoria de 2026-09-26,
// O7; na main de antes: ZERO pedidos na 2ª varredura). A janela seguinte de
// verdade também zera o que ficou pronto na janela (`offlineFeitosNaJanela`,
// R5-4-1): sem isso, na MESMA janela a varredura só baixaria o que falta — nada
// — e não mediria a revalidação.
await page.evaluate(() => { offlineJanelaServida = null; offlineUltimoResultado = null;
  if (typeof offlineFeitosNaJanela !== 'undefined') offlineFeitosNaJanela = { janela: null, epoca: -1, us: new Set() }; });
rotaTile = 0;
await page.evaluate(() => { offlineMarcarGesto(); return offlineVarrer(); });
await esperarNaPagina(page, () => offlineUltimoResultado !== null, 25000);
const revalidou = { rota: rotaTile, res: await page.evaluate(() => offlineUltimoResultado) };
diz('a varredura da janela seguinte REVALIDA pela rede os tiles que já estavam guardados',
  revalidou.rota > 0 && revalidou.res === 'pronto', JSON.stringify(revalidou));

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
// 6f) A FOTO QUE O WAZE TIROU DO AR, e a rede de volta (R7-4-06). Sem sinal o
// card de foto trava e avisa (certo: não dá pra saber). Com o sinal de volta, a
// prova da foto dá 404 — e nada redesenhava: o card seguia dizendo que a foto
// precisava de sinal, com ✕/✓ travados, até a pessoa pular, enquanto o mesmo
// pedido aberto com sinal mostra "Sem Imagem" com ✕/✓ vivos. O servidor DA FOTO
// responde (o 404 é resposta), e isso prova a rede. O 1º tempo do 6e (o
// `online` com a rede sem passar: a sonda também não responde) é o CONTROLE de
// que a trava não sai à toa.
const FOTO_REMOVIDA = 'https://venue-image.waze.com/thumbs/thumb700_removida404';
const fotoRemovida = (r) => (aviao ? r.abort('internetdisconnected')
  : r.fulfill({ status: 404, contentType: 'text/plain', body: 'nao', headers: { 'cache-control': 'no-store' } }));
await ctx.route('**/thumb700_removida404*', fotoRemovida);
const pedidosRemovida = [];
const contarRemovida = (r) => { if (r.url().indexOf('removida404') !== -1) pedidosRemovida.push(r.url()); };
page.on('request', contarRemovida);
aviao = true; await ctx.setOffline(true);
await montar([{ ...PLACE(12, 'NEW_PHOTO'), imageUrls: [FOTO_REMOVIDA] }]);
await esperarNaPagina(page, () => !!document.querySelector('#cardStack .place-card:not(.card-fundo) .card-sem-foto'), 8000);
const removidaSemRede = await lerFotoDoCard();
diz('PRÉ-CONDIÇÃO: sem rede, o card da foto que o Waze tirou do ar avisa, com ✕ e ✓ travados',
  removidaSemRede.temAviso && removidaSemRede.rejTravado && removidaSemRede.lidoTravado, JSON.stringify(removidaSemRede));
// O TECLADO no ↑ — o único botão vivo do card sem a foto —, e o card de agora
// MARCADO: o sinal de volta o REDESENHA, e o foco caía no <body> (R8-4-03,
// MEDIDO com Tab de verdade no r4 da auditoria). A marca é o CONTROLE de que o
// card foi mesmo trocado: sem redesenho, o foco ficaria no ↑ por não ter saído.
const focoAntes6f = await page.evaluate(() => {
  const c = document.querySelector('#cardStack .place-card:not(.card-fundo)');
  c.dataset.smoke6f = 'antes';
  const pular = c.querySelector('.card-btn-skip');
  pular.focus();
  return document.activeElement === pular;
});
const antesDaRemovida = pedidosRemovida.length;
aviao = false;
await ctx.setOffline(false);
const saiuDoAviso = await esperarNaPagina(page, () => { const c = document.querySelector('#cardStack .place-card:not(.card-fundo)');
  return !!(c && !c.querySelector('.card-sem-foto')); }, 10000);
const removidaComRede = await lerFotoDoCard();
diz('a foto tirada do AR, com a rede de volta: o card sai do "precisa de sinal" e destrava ✕ e ✓ — como o aberto com sinal (R7-4-06)',
  saiuDoAviso.ok && !removidaComRede.temAviso && !removidaComRede.rejTravado && !removidaComRede.lidoTravado,
  JSON.stringify({ saiuDoAviso, removidaComRede }));
diz('CONTROLE: a foto foi pedida de novo com a rede de volta e NÃO veio — o 404 é dela, não da rede',
  pedidosRemovida.length > antesDaRemovida && !removidaComRede.fotoVisivel,
  JSON.stringify({ pedidos: pedidosRemovida.length - antesDaRemovida, removidaComRede }));
const focoDepois6f = await page.evaluate(() => {
  const a = document.activeElement;
  const c = document.querySelector('#cardStack .place-card:not(.card-fundo)');
  return { redesenhado: !!(c && c.dataset.smoke6f !== 'antes'), body: a === document.body,
    noPular: !!(a && c && c.contains(a) && a.matches('.card-btn-skip')),
    foco: a ? String(a.className || a.tagName).slice(0, 40) : null };
});
diz('PRÉ-CONDIÇÃO: o teclado estava no ↑ do card sem a foto, e o card foi REDESENHADO pela rede de volta',
  focoAntes6f && focoDepois6f.redesenhado, JSON.stringify({ focoAntes6f, focoDepois6f }));
diz('o card redesenhado mantém o teclado no ↑ do card novo — não o larga no <body> (R8-4-03)',
  focoDepois6f.noPular && !focoDepois6f.body, JSON.stringify(focoDepois6f));
page.off('request', contarRemovida);
await ctx.unroute('**/thumb700_removida404*', fotoRemovida);
// 6g) A PROVA DA FOTO PENDURADA e a rede PROVADA (R8-4-08). O sinal volta e o 1º
// pedido à foto fica PRESO (a conexão que não responde logo depois de o sinal
// voltar): a prova da <img> fica no ar. A rede provada por uma resposta nossa
// era só ANOTADA na prova, e o card seguia com "A foto precisa de sinal" e ✕/✓
// travados até ela terminar — e ela não tinha teto (MEDIDO, r8 da auditoria:
// 12 s depois da volta, travado). A resposta nossa é o que o `API.aoProvarRede`
// faz com o card — `recuperarCardSemFoto({ redeProvada: true })`, chamado aqui
// direto: a resposta de verdade, nesta página sem sessão nem rota da API, poria
// a varredura e a fila de saída no meio (a ligação está no test/offline-tela).
// A PRÉ-CONDIÇÃO é o CONTROLE: com a prova presa e nada provando a rede, o card
// segue travado — e segue preso o pedido quando ele destrava.
const FOTO_PRESA = 'https://venue-image.waze.com/thumbs/thumb700_presa';
const presos6g = [];
let prender6g = false;
const fotoPresa = (r) => {
  if (aviao) return r.abort('internetdisconnected');
  if (prender6g) { prender6g = false; presos6g.push(r); return undefined; }
  return r.fulfill({ status: 404, contentType: 'text/plain', body: 'nao', headers: { 'cache-control': 'no-store' } });
};
await ctx.route('**/thumb700_presa*', fotoPresa);
aviao = true; await ctx.setOffline(true);
await montar([{ ...PLACE(13, 'NEW_PHOTO'), imageUrls: [FOTO_PRESA] }]);
await esperarNaPagina(page, () => !!document.querySelector('#cardStack .place-card:not(.card-fundo) .card-sem-foto'), 8000);
prender6g = true;
aviao = false;
await ctx.setOffline(false);
for (let i = 0; i < 50 && !presos6g.length; i++) await dormir(100);
await dormir(300);   // o tempo de um destravamento indevido aparecer, se houvesse
const presa6g = await lerFotoDoCard();
diz('PRÉ-CONDIÇÃO: com o sinal de volta, a prova da foto ficou PRESA — e, sem nada provando a rede, o card segue travado',
  presos6g.length === 1 && presa6g.temAviso && presa6g.rejTravado && presa6g.lidoTravado,
  JSON.stringify({ presos: presos6g.length, presa6g }));
const t6g = Date.now();
await page.evaluate(() => recuperarCardSemFoto({ redeProvada: true }));
const solto6g = await esperarNaPagina(page, () => { const c = document.querySelector('#cardStack .place-card:not(.card-fundo)');
  return !!(c && !c.querySelector('.card-sem-foto')); }, 3000);
const ms6g = Date.now() - t6g;
const depois6g = await lerFotoDoCard();
diz('com a rede PROVADA, o card sai do "precisa de sinal" NA HORA e destrava ✕ e ✓ — com a prova da foto ainda presa (R8-4-08)',
  solto6g.ok && !depois6g.temAviso && !depois6g.rejTravado && !depois6g.lidoTravado && presos6g.length === 1 && ms6g < 2000,
  JSON.stringify({ ms6g, solto6g, depois6g, presos: presos6g.length }));
for (const r of presos6g.splice(0)) await r.fulfill({ status: 404, body: 'nao', headers: { 'cache-control': 'no-store' } }).catch(() => {});
await ctx.unroute('**/thumb700_presa*', fotoPresa);

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
// A volta do sinal RETOMA a preparação parcial (R4-O3, auditoria de
// 2026-09-29): o `online` dispara a varredura, e ela, pronta, PODA o cache do
// mapa aos tiles da fila — o certo. A seção seguinte compara o cache antes e
// depois do deploy, então a retomada tem que acabar ANTES da primeira medida
// (medido sem esta espera: a poda caía no meio do deploy, "antes=5 depois=1").
// Com o app de antes do O3 nada é retomado, e a espera sai na hora.
// Pelo PRÓPRIO gatilho, e não pelo tempo do `online`: ele chega quando chega,
// e uma retomada que começasse depois desta espera cairia de novo no deploy.
await esperarNaPagina(page, () => navigator.onLine === true, 5000);
await page.evaluate(() => { offlineMarcarGesto(); offlineTalvezVarrer(); });
await esperarNaPagina(page, () => !offlineVarrendo, 30000, 100);

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

// Marca o DOCUMENTO de antes do deploy: a troca de controller o RECARREGA, e a
// seção seguinte só pode começar no documento NOVO (ver abaixo).
await page.evaluate(() => { window.__docDeAntesDoDeploy = true; });
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
//
// E a espera é pelo documento NOVO, não por "há um documento carregado": a
// faxina (que o laço acima vê) roda no `activate`, e a recarga vem DEPOIS dela.
// Esperando só o `load`, o 8b às vezes começava no documento VELHO e a recarga
// caía no meio dele — MEDIDO numa rodada: "dlogCapturar is not defined", o
// `evaluate` rodando na página nova ainda sem o app (auditoria de 2026-09-26).
await page.waitForLoadState('load').catch(() => {});
// E o documento tem de ser o ÚLTIMO do deploy. A página recarrega DUAS vezes:
// pro worker `?deploy=2` e, ~1,6 s depois, de volta pro `/service-worker.js`
// canônico, que o `js/sw-register.js` do documento novo registra no `load`
// (MEDIDO por outro agente do lote L8: 3 de 3 no worktree, 2 de 2 na main).
// Esperando só o PRIMEIRO documento novo, a 8b às vezes começava num que
// recarregava no meio dela — e o relatório saía de página recém-carregada, sem
// a captura nem a queda da rede (reprovou "e leva o que aconteceu" numa rodada).
// O worker canônico no comando só vale depois da segunda recarga; e ele vale um
// instante ANTES dela também (a troca de controller chama a recarga, e o
// documento de antes segue de pé até o novo chegar) — por isso o documento é
// MARCADO e conferido de novo depois de assentar.
const velha8 = await esperarNaPagina(page, () => !window.__docDeAntesDoDeploy && document.readyState === 'complete'
  && typeof offlineVarrer === 'function', 20000);
const swDaEsperaVelha = await page.evaluate(() => navigator.serviceWorker.controller
  && navigator.serviceWorker.controller.scriptURL).catch(() => null);
console.log(`  · a espera ANTIGA (só "o documento novo") voltou em ${velha8.ms} ms, com o worker `
  + `${String(swDaEsperaVelha).replace(/^https?:\/\/[^/]+/, '')} no comando`);
let docDa8b = null;
const prazo8 = Date.now() + 40000;   // rede contra travar: a recarga leva ~1,6 s
while (!docDa8b && Date.now() < prazo8) {
  const canonico = await esperarNaPagina(page, () => !window.__docDeAntesDoDeploy && document.readyState === 'complete'
    && typeof offlineVarrer === 'function' && !!navigator.serviceWorker.controller
    && /\/service-worker\.js$/.test(navigator.serviceWorker.controller.scriptURL), Math.max(0, prazo8 - Date.now()));
  if (!canonico.ok) break;
  const marca = await page.evaluate(() => (window.__docDa8b = window.__docDa8b || String(Math.random()))).catch(() => null);
  await dormir(800);
  const firme = await page.evaluate((m) => window.__docDa8b === m, marca).catch(() => false);
  if (marca && firme) docDa8b = marca;
}
diz('PRÉ-CONDIÇÃO: a 8b começa no documento FINAL do deploy (o worker canônico no comando, sem recarga pendente)',
  !!docDa8b);
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
// (R12-4-06) A BORDA do Cloudflare injeta o Web Analytics, que manda o relatório
// dele por `sendBeacon` pra MESMA origem (`/cdn-cgi/rum?`, que só aceita POST). O
// pedido entra na lista de recursos, e o relatório o levava como CÓDIGO: a
// releitura de comparação levava 405, e toda triagem de produção dizia "o
// servidor respondeu 405 em 1 arquivo". A borda emulada aqui: POST 204, o resto
// 405 — contando os GETs que chegam a ela.
let getsNaBorda8b = 0;
const borda8b = (r) => {
  if (r.request().method() === 'POST') return r.fulfill({ status: 204, body: '' });
  getsNaBorda8b++;
  return r.fulfill({ status: 405, contentType: 'text/plain', body: 'Method Not Allowed' });
};
await page.route('**/cdn-cgi/rum*', borda8b);
const beacon8b = await page.evaluate(() => navigator.sendBeacon(location.origin + '/cdn-cgi/rum?', '{}'));
await esperarNaPagina(page, () => performance.getEntriesByType('resource').some((e) => /\/cdn-cgi\/rum\?/.test(e.name)), 5000, 100);
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
    // (R12-4-06) O envio do beacon da borda: na lista de recursos (o caso foi
    // encenado), e fora do código conferido.
    borda: {
      nosRecursos: (d.recursos || []).filter((r) => /\/cdn-cgi\//.test(r.url || '')).length,
      noCodigo: Object.keys(d.codigo || {}).filter((u) => /\/cdn-cgi\//.test(u)).length,
      noCvr: Object.keys(d.cacheVsRede || {}).filter((u) => /\/cdn-cgi\//.test(u)).length,
    },
  };
  // O SEGUNDO relatório na mesma página (auditoria de 2026-09-26): as releituras
  // `?diag-rede=1` do primeiro ficam na lista de recursos, e o segundo as levava
  // como código — 23 arquivos em vez de 11, o dobro de requisições.
  const [dl2] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.evaluate(() => baixarDiagnostico()),
  ]);
  const arq2 = join(dirDiag, 'diag2.zip');
  await dl2.saveAs(arq2);
  const d2 = lerDiagnostico(arq2).dados;
  relatorio.segundo = {
    n: Object.keys(d2.codigo || {}).length, cvr: Object.keys(d2.cacheVsRede || {}).length,
    comDiagRede: Object.keys(d2.codigo || {}).filter((u) => /diag-rede/.test(u)).length,
    // CONTROLE: as releituras do primeiro ESTÃO na lista de recursos do segundo —
    // sem elas, "o segundo não as levou" passaria sem o caso existir.
    releiturasNosRecursos: (d2.recursos || []).filter((r) => /diag-rede/.test(r.url)).length,
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
diz('o 2º relatório na mesma página compara o MESMO código — sem as releituras do 1º',
  relatorio.segundo?.releiturasNosRecursos > 0 && relatorio.segundo?.comDiagRede === 0
  && relatorio.segundo?.n === relatorio.codigo?.n && relatorio.segundo?.cvr === relatorio.cvr?.n,
  JSON.stringify({ primeiro: relatorio.codigo?.n, segundo: relatorio.segundo }));
await page.unroute('**/cdn-cgi/rum*', borda8b);
// A PRÉ-CONDIÇÃO (o envio do beacon está na lista de recursos que o relatório lê)
// é o controle: sem ela, "não levou" passaria sem o caso existir.
diz('o envio do beacon da borda (`/cdn-cgi/rum?`) fica fora do código conferido — e nenhum GET vai à borda (R12-4-06)',
  beacon8b === true && relatorio.borda?.nosRecursos >= 1 && relatorio.borda.noCodigo === 0 && relatorio.borda.noCvr === 0
  && getsNaBorda8b === 0, JSON.stringify({ beacon8b, borda: relatorio.borda, getsNaBorda8b }));
const docNoFim8b = await page.evaluate(() => window.__docDa8b).catch(() => null);
diz('e a 8b rodou inteira no MESMO documento — nenhuma recarga no meio (o relatório é da página que viu a queda)',
  !!docDa8b && docNoFim8b === docDa8b, `${docDa8b} → ${docNoFim8b}`);
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
  // A CAPTURA acusa uma vez, com a hora; a seguinte, sem falha nova, cala
  // (auditoria de 2026-09-26: o anel acumulado repetia a falha em toda captura).
  const c1 = dlogCapturar('manual');
  const c2 = dlogCapturar('manual');
  const a1 = (c1.alertas || []).find((a) => a.chave === 'tileGuardadoFalhou');
  r.captura1 = a1 ? { n: a1.n, quando: a1.quando } : null;
  r.captura2 = (c2.alertas || []).some((a) => a.chave === 'tileGuardadoFalhou');
  diagTilesGuardadosQueFalharam = [];
  return r;
});
diz('CONTROLE: sem falha registrada, a sentinela do mapa cala',
  !sentMapa.semAlerta.includes('tileGuardadoFalhou'), JSON.stringify(sentMapa));
diz('o tile GUARDADO que falha entra no anel — e o que não está guardado, não',
  sentMapa.anel.length === 1 && sentMapa.anel[0] === 'guardado', JSON.stringify(sentMapa));
diz('e a sentinela do mapa acusa', sentMapa.comAlerta.includes('tileGuardadoFalhou'), JSON.stringify(sentMapa));
diz('a captura acusa a falha UMA vez, com a hora — e a seguinte, sem falha nova, cala',
  sentMapa.captura1?.n === 1 && Array.isArray(sentMapa.captura1?.quando) && !Number.isNaN(Date.parse(sentMapa.captura1.quando[0]))
  && sentMapa.captura2 === false, JSON.stringify({ c1: sentMapa.captura1, c2: sentMapa.captura2 }));
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

secao('8c. O DIAGNÓSTICO COM A REDE PENDURADA sai no orçamento — e diz o que não chegou');
// Auditoria de 2026-09-26 (D15): as leituras do relatório eram em SÉRIE, cada
// uma com o seu teto de 4 s. Com a rede pendurada (portal cativo, sinal indo e
// voltando), o arquivo levava ~48 s pra sair, com o botão em "Gerando…" sem
// sinal nenhum. Contexto próprio, sem worker; a rede de mesma origem (fora a
// API) é PENDURADA depois de a página abrir — nunca responde.
const ctxL = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
const pgL = await ctxL.newPage();
pgL.on('pageerror', (e) => errosJs.push({ secao: secaoAtual, txt: String(e.message) }));
await pgL.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await esperarNaPagina(pgL, () => typeof baixarDiagnostico === 'function', 20000, 100);
const dirL = mkdtempSync(join(tmpdir(), 'diag-8c-'));
const medirRelatorio = async (nome) => {
  const t0 = Date.now();
  const [dl] = await Promise.all([pgL.waitForEvent('download', { timeout: 90000 }), pgL.evaluate(() => baixarDiagnostico())]);
  const arq = join(dirL, nome + '.zip');
  await dl.saveAs(arq);
  const { dados } = lerDiagnostico(arq);
  return { s: Math.round((Date.now() - t0) / 100) / 10, coleta: dados.coleta,
           semResposta: Object.values(dados.codigo || {}).filter((v) => v && v.semResposta).length };
};
let relL = null, relPendurado = null, pendurados = 0;
try {
  // CONTROLE: com a rede boa, nada fica sem resposta (senão "diz o que não
  // chegou" passaria marcando tudo, sempre).
  relL = await medirRelatorio('rede-boa');
  await ctxL.route((u) => u.origin === new URL(BASE).origin && !u.pathname.startsWith('/api/'), () => { pendurados++; });
  relPendurado = await medirRelatorio('pendurada');
} catch (e) {
  relPendurado = { erro: String((e && e.message) || e).slice(0, 200) };
} finally {
  rmSync(dirL, { recursive: true, force: true });
}
diz('CONTROLE: com a rede boa, o relatório não marca nada sem resposta',
  relL?.coleta && relL.coleta.semResposta.length === 0 && relL.semResposta === 0, JSON.stringify(relL));
diz('com a rede PENDURADA o arquivo sai dentro do orçamento (eram ~48 s)',
  relPendurado?.s <= 15 && pendurados >= 10, JSON.stringify({ s: relPendurado?.s, pendurados }));
diz('e diz, no arquivo, o que não chegou',
  relPendurado?.coleta?.semResposta?.length >= 10 && relPendurado.semResposta >= 10
  && relPendurado.coleta.orcamentoMs > 0, JSON.stringify(relPendurado?.coleta).slice(0, 300));
await ctxL.close();

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
// A espera de cada decisão antes de pousar: um número (ms) ou uma função que
// devolve a promessa da espera (ver o passo 6).
let atrasoDecisao9b = () => 0;
// Quantas buscas CHEGARAM (na chegada, não na resposta), e quem espera a próxima.
let buscasChegadas9b = 0;
const aoChegarBusca9b = [];
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
    buscasChegadas9b++;
    for (const ok of aoChegarBusca9b.splice(0)) ok();
    if (atrasoBusca9b) await dormir(atrasoBusca9b);
    b.tResposta = Date.now();
    buscas9b.push(b);
    return json({ success: true, places, hasMore: false, page: 1, total: places.length });
  }
  if (rota === 'marcar-lido' || rota === 'validar-place') {
    const chave = corpo.venueID + '|' + corpo.updateRequestID;
    const espera = atrasoDecisao9b(chave);
    if (typeof espera === 'function') await espera();
    else if (espera) await dormir(espera);
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
// E espera o FIM da ação NA PÁGINA: o "Waze" desta seção anota a decisão ANTES
// de responder, então ela aparecer aqui não diz que a página já recebeu a
// resposta e gravou o pouso. MEDIDO com a máquina carregada: a leitura chegou
// antes do pouso em 3 de 12 rodadas (na base e no ramo), e numa delas o
// `about:blank` logo abaixo matou a resposta — o pouso nunca foi gravado, o ✕
// voltou como card na reabertura e a seção reprovou 7 vezes em cascata.
await esperarNaPagina(page, () => AppState.inFlightActions === 0, 10000, 50);
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
// A 1ª decisão pousa 100 ms depois de a busca CHEGAR — nunca antes. Na abertura
// o esvaziamento e a busca saem juntos, e quem chega primeiro no servidor é
// questão de milissegundos: com a espera fixa de 100 ms, a margem (o pouso menos
// a chegada da busca) foi de 57 a 127 ms em 11 de 12 rodadas e de -30 ms numa
// (na BASE, com a máquina carregada; -8 ms numa rodada do smoke inteiro) — a
// decisão pousava antes de a lista ser tirada e a pré-condição reprovava. O
// "Waze" segura a resposta até a busca chegar, que é o cenário que a
// pré-condição exige; com teto, e sem a busca a pré-condição reprova.
const buscasAntes6 = buscasChegadas9b;
const depoisDaBusca6 = () => (buscasChegadas9b > buscasAntes6 ? Promise.resolve()
  : Promise.race([new Promise((ok) => aoChegarBusca9b.push(ok)), dormir(10000)])).then(() => dormir(100));
atrasoDecisao9b = (k) => (k === k106 ? depoisDaBusca6 : 4000);
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
// Espera o registro DESTA abertura ter `n` capturas guardadas. A CONTA volta
// pro Node e a comparação é feita aqui: a função vai pra página SERIALIZADA,
// sem o fechamento, e com o `n` dentro dela ele era `undefined` lá — o `try`
// engolia o ReferenceError, e a espera virava um sono de 10 s que nunca
// confirmava nada (MEDIDO na auditoria de 2026-09-26: o registro estava no
// aparelho, com a captura, e a espera dizia que não). Não abre a base que não
// existe (`open` sem versão a CRIARIA vazia, sem a tabela, e a gravação do app
// que viesse depois não teria onde escrever), e devolve o que VIU.
const capturasNesta9c = (pg) => pg.evaluate(async () => { try {
  if (!(await indexedDB.databases()).some((d) => d.name === 'waze_places_diag')) return 0;
  const db = await new Promise((ok, err) => { const r = indexedDB.open('waze_places_diag'); r.onsuccess = () => ok(r.result); r.onerror = err; });
  const todas = await new Promise((ok) => { const r = db.transaction('aberturas').objectStore('aberturas').getAll(); r.onsuccess = () => ok(r.result); });
  db.close();
  const esta = todas.find((a) => a.id === DIAG_ABERTURA.id);
  return esta ? (esta.momentos || []).length : 0;
} catch (e) { return -1; } }).catch(() => -1);
const guardouNesta9c = async (pg, n, tetoMs = 10000) => {
  const t0 = Date.now();
  for (;;) {
    const viu = await capturasNesta9c(pg);
    if (viu === n) return { ok: true, ms: Date.now() - t0, viu };
    if (Date.now() - t0 > tetoMs) return { ok: false, ms: Date.now() - t0, viu };
    await dormir(100);
  }
};

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
// Um ciclo de sessão FECHADO no diário (entrou há 50 h, caiu há 20 h): é ele que
// faz o relatório levar a duração da sessão, que o leitor imprimia como
// "[object Object]" (auditoria de 2026-09-26). O leitor roda sobre o arquivo DE
// VERDADE logo abaixo — o teste de unidade monta a mesma seção pelo `diagSessao`.
await p2d.evaluate(() => {
  const H = 3600e3, agora = Date.now();
  const anel = JSON.parse(localStorage.getItem('waze_places_sessoes') || '[]');
  localStorage.setItem('waze_places_sessoes', JSON.stringify([{ t: agora - 50 * H, e: 'token+', via: 'cookies' },
    { t: agora - 20 * H, e: 'caiu', motivo: 'srv.err.cookiesExpired' }, ...anel]));
});
// O que acontece ENQUANTO o arquivo é montado (auditoria de 2026-09-26, D11):
// uma anotação no diário e um TOQUE no botão NO MEIO do empacotamento — o
// construtor do `CompressionStream` é chamado pelo `zipar`, depois do retrato. O
// toque vai pelos ouvintes do PRÓPRIO botão (ponteiro que desce e sobe nele),
// como o dedo: o toque do DevTools não cabe dentro do zip. O carimbo do
// "baixado" era o do FIM do download, e as duas coisas sumiam: fora do arquivo
// E fora da cópia guardada. Com o carimbo do retrato, voltam na abertura 3.
await p2d.evaluate(() => {
  const Orig = window.CompressionStream;
  window.__compressaoOriginal = Orig;
  let uma = false;
  window.CompressionStream = class extends Orig {
    constructor(f) {
      if (!uma) {
        uma = true;
        dfato('smoke.duranteOZip');
        const b = document.getElementById('devFabBtn');
        b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 97, bubbles: true }));
        b.dispatchEvent(new PointerEvent('pointerup', { pointerId: 97, bubbles: true }));
      }
      super(f);
    }
  };
});
try {
  const [dl] = await Promise.all([
    p2d.waitForEvent('download', { timeout: 30000 }),
    p2d.evaluate(() => baixarDiagnostico()),
  ]);
  await p2d.evaluate(() => { window.CompressionStream = window.__compressaoOriginal; });
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
    triagemSecao: triagem.includes('OUTRAS ABERTURAS (guardadas no aparelho') && triagem.includes('abertura ' + id1d),
    triagemAlerta: triagem.includes('[abertura anterior ' + id1d + ']'),
    // A abertura que FECHOU antes desta não é "outra aba aberta junto" (R7-4-04):
    // nem no arquivo (a trava dela foi solta ao fechar, e ela não gravou depois)
    // nem na triagem.
    simultanea: (d.aberturasAnteriores || []).some((a) => a.simultanea), triagemOutraAba: triagem.includes('OUTRA ABA'),
    vazouToken: triagem.includes('tok-9c'),
    duracao: (triagem.match(/duração da sessão \(h\): [^·]*· [^·]*· [^·]*· [^·]*/) || [''])[0].trim(),
    objetoCru: triagem.includes('[object Object]'),
    // O que chegou DURANTE o zip não está no arquivo (ele é o retrato de antes).
    desta: (d.momentos || []).length,
    duranteNoArquivo: (d.diario || []).some((e) => e.k === 'smoke.duranteOZip'),
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
diz('a abertura que FECHOU antes desta segue ANTERIOR — não vira "outra aba aberta junto" (R7-4-04, controle)',
  rel9c?.simultanea === false && rel9c?.triagemOutraAba === false, JSON.stringify(rel9c));
diz('o leitor mostra a duração da sessão do relatório de verdade — números, nunca "[object Object]"',
  rel9c?.objetoCru === false && /^duração da sessão \(h\): mediana 30 · menor–maior 30–30 · n 1 · pisos 0/.test(rel9c?.duracao || ''),
  JSON.stringify({ duracao: rel9c?.duracao, objetoCru: rel9c?.objetoCru }));
diz('PRÉ-CONDIÇÃO: a captura e a anotação feitas DURANTE o zip não estão no arquivo (ele é o retrato de antes)',
  rel9c?.desta === 1 && rel9c?.duranteNoArquivo === false, JSON.stringify({ desta: rel9c?.desta, durante: rel9c?.duranteNoArquivo }));
// BAIXADO, sai do aparelho o que FOI no arquivo — e só isso: a abertura anterior
// (entregue inteira) sai, e a desta fica só com o que NÃO foi (a captura do meio
// do zip). Apagava a base INTEIRA, e com ela o que outra aba gravou depois de o
// relatório ler a base (auditoria de 2026-10-01, R6-4-5; as duas abas estão no
// test/diag-guarda). A comparação é feita no Node: a função vai pra página
// serializada, sem os ids daqui.
let g3d = null;
for (const t0 = Date.now(); Date.now() - t0 < 10000; await dormir(100)) {
  g3d = await guardado9c(p2d);
  const esta = (g3d.abertas || []).find((a) => a.id === r2d.id);
  if (!(g3d.abertas || []).some((a) => a.id === id1d) && esta && esta.capturas === 1) break;
}
const esta3d = (g3d?.abertas || []).find((a) => a.id === r2d.id);
const s4d = await selo9c(p2d);
// 4 = as 2 guardadas + a desta abertura + a do meio do zip: o número conta o
// que a pessoa registrou, baixado ou não.
diz('BAIXADO, sai do aparelho o que FOI no arquivo — a abertura anterior, e desta só fica a captura do meio do zip (e nesta abertura o número segue contando, como sempre)',
  !(g3d?.abertas || []).some((a) => a.id === id1d) && esta3d?.capturas === 1 && s4d.txt === '4', JSON.stringify({ g3d, s4d }));
// Segue usando depois do download: uma captura NOVA, e o app vai pro fundo.
// É o caso que separa "guardar o que não foi entregue" de "guardar tudo": com
// o anel desta abertura tendo uma baixada e uma nova, só a nova pode voltar.
const tBaixado = await p2d.evaluate(() => diagBaixadoEm);
const tocouPos = await tocar9c(p2d, cdp2d);
await guardouNesta9c(p2d, 2);
await irProFundo9c(p2d);
await p2d.close({ runBeforeUnload: true });

// 3. Reaberta depois do download: o que foi entregue não volta.
const p3d = await abrir9c('abertura 3');
await pronta9c(p3d);
await carregou9c(p3d);
const r3d = await p3d.evaluate((tb) => ({ capturas: diagMomentosAnteriores().length,
  manuais: diagCapturasAnterioresDoEditor().length,
  diarioAntes: diagAberturasAnteriores.flatMap((a) => a.diario || []).filter((e) => e.t <= tb).length,
  durante: diagAberturasAnteriores.flatMap((a) => a.diario || []).some((e) => e.k === 'smoke.duranteOZip') }), tBaixado);
const s5d = await selo9c(p3d);
diz('o que foi BAIXADO não volta: reaberta, só volta o que NÃO foi no arquivo — a captura do meio do zip e a de depois do download — e o diário de antes do retrato também não',
  tocouPos && r3d.capturas === 2 && r3d.manuais === 2 && r3d.diarioAntes === 0 && s5d.txt === '2',
  JSON.stringify({ tocouPos, r3d, s5d }));
diz('o que o diário anotou DURANTE o zip volta na abertura seguinte (não foi no arquivo, e não pode sumir)',
  r3d.durante === true, JSON.stringify(r3d));

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
// O número: as duas que a abertura 2 guardou depois do retrato (a do meio do zip
// e a pós-download) + a da "fresca" = 3.
diz('a abertura guardada há MAIS de 24 h sai do aparelho; a de 23 h fica, com a captura contando no número',
  !r4d.includes('velha') && r4d.includes('fresca') && !g4d.abertas.some((a) => a.id === 'velha') && s6d.txt === '3',
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
  naoBaixadas === 3 && marcadoDepoisDo1o === true && r5a.ativo === true && r5a.memoria > 0 && r5a.base === true,
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

secao('9d. O SEGREDO DO PAREAMENTO NÃO VAI PRO DIAGNÓSTICO — nem pro aparelho');
// Auditoria de 2026-09-26 (D1). Quando a área de transferência recusa, o link
// `/#pair=<segredo>` vira um toast copiável — e ele ia inteiro pro diário, pra
// lista de toasts da captura e (fechado o modal, o que APAGA o `data-raw`) pro
// `dom`: pro relatório E pra cópia guardada no aparelho. O segredo vale uma
// sessão nova por 5 minutos. O canário é procurado no arquivo INTEIRO e na base.
const SEGREDO_9D = 'CANARIOPAREAMENTO9DX';
const ctx9d = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR',
  hasTouch: true, isMobile: true, serviceWorkers: 'block', acceptDownloads: true });
await ctx9d.route('**/*-tiles/live/base/**', servirTile);
await ctx9d.route('**/api/*', (r) => {
  const rota = r.request().url().split('/api/')[1];
  const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (rota === 'buscar-places') return json({ success: true, places: [SO_MAPA(151), SO_MAPA(152)], hasMore: false, page: 1, total: 2 });
  if (rota === 'perfil') return json({ success: true, profile: { id: 1, userName: 'e', rank: 5, isAreaManager: true, isStaff: false, editableCountryIDs: [30], areas: [] } });
  if (rota === 'parear') return json({ success: true, code: SEGREDO_9D, expiresIn: 300 });
  return r.abort('failed');
});
await ctx9d.addInitScript(() => { try { if (!localStorage.getItem('__9d')) {
  localStorage.setItem('__9d', '1');
  localStorage.setItem('waze_session_token', 'tok-9d');
  localStorage.setItem('waze_places_devmode', JSON.stringify({ unlocked: true, active: true }));
  localStorage.setItem('waze_places_preferences', JSON.stringify({ comoFuncionaVisto: true, undoEnabled: true }));
} } catch (e) {} });
const p9d = await ctx9d.newPage();
p9d.on('pageerror', (e) => errosJs.push({ secao: secaoAtual, txt: String(e.message) }));
p9d.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violacoes.push({ secao: secaoAtual, txt: m.text() }); });
await p9d.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await pronta9c(p9d);
await p9d.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true,
  value: { writeText: () => Promise.reject(new DOMException('negado', 'NotAllowedError')) } }); });
await p9d.evaluate(() => abrirPareamento());
await esperarNaPagina(p9d, () => !document.getElementById('pairCopyLinkBtn').disabled, 10000, 100);
await p9d.evaluate(() => document.getElementById('pairCopyLinkBtn').click());
await esperarNaPagina(p9d, () => [...document.querySelectorAll('#toastContainer > *')].some((e) => /#pair=/.test(e.textContent)), 5000, 100);
await p9d.evaluate(() => document.getElementById('pairShowClose').click());   // a limpeza apaga o `data-raw`
await dormir(300);
const pre9d = await p9d.evaluate((s) => ({
  toast: [...document.querySelectorAll('#toastContainer > *')].some((e) => e.textContent.includes(s)),
  dataRaw: !!document.getElementById('pairCode').dataset.raw }), SEGREDO_9D);
diz('PRÉ-CONDIÇÃO: o link com o segredo segue na tela (o toast copiável), e fechar o modal já apagou o `data-raw`',
  pre9d.toast && !pre9d.dataRaw, JSON.stringify(pre9d));
const cdp9d = await ctx9d.newCDPSession(p9d);
const tocou9d = await tocar9c(p9d, cdp9d);
await guardouNesta9c(p9d, 1);
const base9d = await p9d.evaluate((s) => new Promise((ok) => {
  const req = indexedDB.open('waze_places_diag');
  req.onerror = () => ok({ erro: 'abrir' });
  req.onsuccess = () => { const db = req.result;
    const r = db.transaction('aberturas').objectStore('aberturas').getAll();
    r.onsuccess = () => { db.close(); const t = JSON.stringify(r.result);
      ok({ tem: t.includes(s), capturas: r.result.reduce((n, a) => n + (a.momentos || []).length, 0) }); }; };
}), SEGREDO_9D);
diz('a captura com o link na tela vai pro aparelho SEM o segredo', tocou9d && base9d.capturas >= 1 && base9d.tem === false,
  JSON.stringify({ tocou9d, base9d }));
let rel9d = null;
const dir9d = mkdtempSync(join(tmpdir(), 'diag-9d-'));
try {
  const [dl] = await Promise.all([p9d.waitForEvent('download', { timeout: 30000 }), p9d.evaluate(() => baixarDiagnostico())]);
  const arq = join(dir9d, 'diag.zip');
  await dl.saveAs(arq);
  const cru = JSON.stringify(lerDiagnostico(arq).dados);
  const triagem = execFileSync(process.execPath, [join(ROOT, 'tools/diag-resumo.mjs'), arq], { encoding: 'utf8', timeout: 20000 });
  rel9d = { noArquivo: cru.includes(SEGREDO_9D), marcado: cru.includes('#pair=[código de pareamento]'),
            naTriagem: triagem.includes(SEGREDO_9D), aviso: /"sensivel":true/.test(cru) };
} catch (e) {
  rel9d = { erro: String((e && e.message) || e).slice(0, 200) };
} finally {
  rmSync(dir9d, { recursive: true, force: true });
}
diz('nenhuma seção do relatório traz o segredo — e o lugar dele sai marcado (o toast estava lá)',
  rel9d?.noArquivo === false && rel9d?.marcado === true, JSON.stringify(rel9d));
diz('o diário anota que houve o aviso SENSÍVEL, sem o texto; e a triagem também não imprime o segredo',
  rel9d?.aviso === true && rel9d?.naTriagem === false, JSON.stringify(rel9d));
await ctx9d.close();

secao('9e. DUAS ABAS: desligar o modo dev, ou dar "Sair", numa chega à outra');
// Auditoria de 2026-09-26 (D2). A outra aba seguia com o FAB e com o modo dev
// na memória, e a captura seguinte RECRIAVA a base com o DOM da tela. E a poda
// de 24 h só rodava com o modo dev ligado — a sobra ficava indefinidamente.
// Duas páginas do MESMO contexto (o mesmo aparelho): o aviso do navegador
// (evento `storage`) é o de verdade.
const ctx9e = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR',
  hasTouch: true, isMobile: true, serviceWorkers: 'block' });
await ctx9e.route('**/*-tiles/live/base/**', servirTile);
await ctx9e.route('**/api/*', (r) => {
  const rota = r.request().url().split('/api/')[1];
  const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (rota === 'buscar-places') return json({ success: true, places: [SO_MAPA(161), SO_MAPA(162)], hasMore: false, page: 1, total: 2 });
  if (rota === 'perfil') return json({ success: true, profile: { id: 1, userName: 'e', rank: 5, isAreaManager: true, isStaff: false, editableCountryIDs: [30], areas: [] } });
  return r.abort('failed');
});
const abrir9e = async (nome) => {
  const pg = await ctx9e.newPage();
  pg.on('pageerror', (e) => errosJs.push({ secao: secaoAtual + ` [${nome}]`, txt: String(e.message) }));
  pg.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text()))
    violacoes.push({ secao: secaoAtual + ` [${nome}]`, txt: m.text() }); });
  await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  return pg;
};
const devLigado9e = (pg, ligado) => pg.evaluate((l) => localStorage.setItem('waze_places_devmode',
  JSON.stringify({ unlocked: true, active: l })), ligado);
const temBase9e = (pg) => pg.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'waze_places_diag'));
const prep9e = await abrir9e('preparo');
await esperarNaPagina(prep9e, () => typeof API !== 'undefined', 20000, 100);
await prep9e.evaluate(() => {
  API.setSession('tok-9e');
  localStorage.setItem('waze_places_preferences', JSON.stringify({ comoFuncionaVisto: true, undoEnabled: true }));
});
await devLigado9e(prep9e, true);
await prep9e.close({ runBeforeUnload: true });

// 1. A aba A DESLIGA o modo dev (o interruptor de verdade); a aba B tinha uma
// captura NÃO BAIXADA. Ela é do APARELHO (está na base), e desligar em A a
// apaga: o 1º toque em A AVISA e não desliga — ele desligava calado, contando só
// os registros da memória de A (auditoria de 2026-10-01, R6-4-4). O 2º desliga,
// e a aba B desliga junto.
const a9e = await abrir9e('A'), b9e = await abrir9e('B');
await pronta9c(a9e); await pronta9c(b9e);
const cdpB9e = await ctx9e.newCDPSession(b9e);
const tocouB = await tocar9c(b9e, cdpB9e);
const guardouB = await guardouNesta9c(b9e, 1);
diz('PRÉ-CONDIÇÃO: a captura da aba B foi pro aparelho', tocouB && guardouB.ok, JSON.stringify({ tocouB, guardouB }));
const desligarA9e = () => a9e.evaluate(() => { const cb = document.getElementById('prefDevModeActive');
  cb.checked = false; cb.dispatchEvent(new Event('change')); });
const naMemoriaDeA = await a9e.evaluate(() => dlogNaoBaixados());
await desligarA9e();
// A conta do aparelho lê a base (assíncrona): o desfecho do 1º toque é o aviso — a janela do 2º toque aberta.
const avisouA = await esperarNaPagina(a9e, () => desligarDevConfirmadoAte > Date.now(), 5000, 100);
const r1e = await a9e.evaluate(() => ({ dev: AppState.devMode.active, marcado: document.getElementById('prefDevModeActive').checked,
  naoBaixados: dlogNaoBaixados(), avisos: document.querySelectorAll('#toastContainer > *').length }));
const bSegue = await b9e.evaluate(() => ({ dev: AppState.devMode.active, momentos: dlogMomentos.length }));
diz('a captura NÃO baixada da aba B conta no aviso da aba A: o 1º toque avisa e nada é apagado (R6-4-4)',
  naMemoriaDeA === 0 && avisouA.ok && r1e.dev === true && r1e.marcado === true && r1e.naoBaixados === 1 && r1e.avisos > 0
  && bSegue.dev === true && bSegue.momentos === 1, JSON.stringify({ naMemoriaDeA, avisouA, r1e, bSegue }));
await desligarA9e();                                   // o 2º toque, dentro dos 15 s
const chegouB = await esperarNaPagina(b9e, () => AppState.devMode.active === false
  && document.getElementById('devFab').classList.contains('hidden') && dlogMomentos.length === 0, 5000, 100);
diz('desligado na aba A, a aba B desliga junto: o botão some e as capturas saem da memória', chegouB.ok,
  JSON.stringify(await b9e.evaluate(() => ({ dev: AppState.devMode.active, momentos: dlogMomentos.length }))));
await irProFundo9c(b9e);
await b9e.close({ runBeforeUnload: true });
const semBase1 = await esperarNaPagina(a9e, async () => !(await indexedDB.databases()).some((d) => d.name === 'waze_places_diag'), 5000, 100);
diz('a aba B, indo pro fundo e fechando, não recria a base que a aba A apagou', semBase1.ok);

// 2. A CORRIDA: o armazenamento já diz "desligado" e o aviso ainda não chegou a
// esta aba (a memória diz ligado). Encenada escrevendo NA PRÓPRIA aba — o evento
// `storage` não dispara em quem escreve. A captura não pode ir pro aparelho.
await devLigado9e(a9e, true);
await a9e.close({ runBeforeUnload: true });
const c9e = await abrir9e('C');
await pronta9c(c9e);
await devLigado9e(c9e, false);                         // storage desligado, memória ligada
const cdpC9e = await ctx9e.newCDPSession(c9e);
const tocouC = await tocar9c(c9e, cdpC9e);
await c9e.evaluate(() => (typeof diagGuardando !== 'undefined' ? diagGuardando : null));
// A base pode EXISTIR (a leitura do guardado a abre, vazia, na abertura com o
// modo dev ligado): o que não pode é um registro com a captura.
const gC = await guardado9c(c9e);
diz('com o modo dev desligado no ARMAZENAMENTO (o aviso ainda não chegou), a captura não vai pro aparelho',
  tocouC && (await c9e.evaluate(() => AppState.devMode.active)) === true
  && !(gC.abertas || []).some((x) => x.capturas > 0), JSON.stringify({ tocouC, gC }));

// 3. O "Sair" na aba D chega à aba E: ela tinha uma captura guardada.
await devLigado9e(c9e, true);
await c9e.close({ runBeforeUnload: true });
const d9e = await abrir9e('D'), e9e = await abrir9e('E');
await pronta9c(d9e); await pronta9c(e9e);
const cdpE9e = await ctx9e.newCDPSession(e9e);
const tocouE = await tocar9c(e9e, cdpE9e);
const guardouE = await guardouNesta9c(e9e, 1);
diz('PRÉ-CONDIÇÃO: a captura da aba E foi pro aparelho', tocouE && guardouE.ok, JSON.stringify({ tocouE, guardouE }));
await d9e.evaluate(() => { handleLogout(); });
const chegouE = await esperarNaPagina(e9e, () => AppState.devMode.active === false
  && document.getElementById('devFab').classList.contains('hidden') && dlogMomentos.length === 0, 5000, 100);
diz('o "Sair" na aba D chega à aba E: o modo dev desliga, o botão some e as capturas saem', chegouE.ok);
await irProFundo9c(e9e);
await e9e.close({ runBeforeUnload: true });
const semBase3 = await esperarNaPagina(d9e, async () => !(await indexedDB.databases()).some((d) => d.name === 'waze_places_diag'), 5000, 100);
diz('e nada volta pro aparelho quando a aba E fecha', semBase3.ok);
await d9e.close();

// 4. A SOBRA com o modo dev desligado sai na próxima abertura (a poda de 24 h só
// roda com ele ligado). Planta uma abertura FRESCA, com o modo dev desligado.
const f9e = await abrir9e('F');
await esperarNaPagina(f9e, () => typeof API !== 'undefined', 20000, 100);
await f9e.evaluate(() => new Promise((ok) => {
  API.setSession('tok-9e');
  localStorage.setItem('waze_places_devmode', JSON.stringify({ unlocked: true, active: false }));
  const req = indexedDB.open('waze_places_diag', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('aberturas', { keyPath: 'id' });
  req.onsuccess = () => { const db = req.result; const tx = db.transaction('aberturas', 'readwrite');
    tx.objectStore('aberturas').put({ id: 'sobra', inicio: Date.now() - 3600e3, salvoEm: Date.now() - 1800e3, salvoPor: 'oculta',
      momentos: [{ t: new Date().toISOString(), motivo: 'manual', dom: '<html>dado de terceiro</html>' }], diario: [], chamadas: [], erros: [] });
    tx.oncomplete = () => { db.close(); ok(); }; };
}));
diz('PRÉ-CONDIÇÃO: a sobra está no aparelho', await temBase9e(f9e));
await f9e.close({ runBeforeUnload: true });
const g9e = await abrir9e('G');
const faxina = await esperarNaPagina(g9e, async () => !(await indexedDB.databases()).some((d) => d.name === 'waze_places_diag'), 10000, 100);
diz('com o modo dev DESLIGADO, a sobra sai do aparelho na abertura', faxina.ok
  && (await g9e.evaluate(() => dfatoAnel.some((e) => e.k === 'diag.sobraApagada'))), JSON.stringify(faxina));
await g9e.close();
await ctx9e.close();

secao('9f. FECHAR SEM IR PRO FUNDO — recarregar e fechar a aba não perdem a abertura');
// Auditoria de 2026-09-29 (D2). A gravação na base é ASSÍNCRONA, e recarregar
// a página ou fechar a aba a aborta: MEDIDO antes do conserto, recarregar
// perdeu a abertura em 5 de 5 e fechar em 2 de 5. A 9c não via porque vai pro
// FUNDO antes de fechar (o celular), e aí a página segue viva até gravar. Aqui
// ninguém vai pro fundo: a página é recarregada ou fechada direto, como no
// computador, e o que tem que chegar é o RETRATO síncrono do `pagehide`.
//
// "Nada foi escrito" se lê numa página da MESMA origem que NÃO roda o app (o
// manifesto): a abertura do app com o modo dev desligado apaga a sobra, e aí
// "não escreveu" e "escreveu e a faxina apagou" ficariam iguais. O CONTROLE de
// que essa página enxerga o retrato é olhar por ela depois de um fechar COM o
// modo dev (passo 2), antes de o app reabrir e consumi-lo.
const ctx9f = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', serviceWorkers: 'block' });
await ctx9f.route('**/*-tiles/live/base/**', servirTile);
await ctx9f.route('**/api/*', (r) => {
  const rota = r.request().url().split('/api/')[1];
  const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (rota === 'buscar-places') return json({ success: true, places: [SO_MAPA(171), SO_MAPA(172)], hasMore: false, page: 1, total: 2 });
  if (rota === 'perfil') return json({ success: true, profile: { id: 1, userName: 'e', rank: 5, isAreaManager: true, isStaff: false, editableCountryIDs: [30], areas: [] } });
  return r.abort('failed');
});
const abrir9f = async (nome) => {
  const pg = await ctx9f.newPage();
  pg.on('pageerror', (e) => errosJs.push({ secao: secaoAtual + ` [${nome}]`, txt: String(e.message) }));
  pg.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text()))
    violacoes.push({ secao: secaoAtual + ` [${nome}]`, txt: m.text() }); });
  await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  return pg;
};
// O aparelho visto de FORA do app: os retratos no localStorage e se a base existe.
const olhar9f = async () => {
  const pg = await ctx9f.newPage();
  await pg.goto(BASE + '/manifest.json', { waitUntil: 'load' });
  const r = await pg.evaluate(async () => ({
    retratos: Object.keys(localStorage).filter((k) => k.startsWith('waze_places_diag_retrato')),
    base: (await indexedDB.databases()).some((d) => d.name === 'waze_places_diag'),
    app: typeof AppState !== 'undefined' }));
  await pg.close();
  return r;
};
// A abertura `id` veio de volta, com a marca no diário?
const voltou9f = (pg, id, marca) => pg.evaluate(([i, m]) => {
  const a = diagAberturasAnteriores.find((x) => x.id === i);
  return { tem: !!a, marca: !!a && (a.diario || []).some((e) => e.k === m), salvoPor: a ? a.salvoPor : null,
           retratosNoAparelho: Object.keys(localStorage).filter((k) => k.startsWith('waze_places_diag_retrato')).length };
}, [id, marca]);
const prep9f = await abrir9f('preparo');
await esperarNaPagina(prep9f, () => typeof API !== 'undefined', 20000, 100);
await prep9f.evaluate(() => {
  API.setSession('tok-9f');
  localStorage.setItem('waze_places_preferences', JSON.stringify({ comoFuncionaVisto: true, undoEnabled: true }));
  localStorage.setItem('waze_places_devmode', JSON.stringify({ unlocked: true, active: true }));
});
await prep9f.close({ runBeforeUnload: true });

// 1. RECARREGAR, direto.
const a9f = await abrir9f('recarregar');
await pronta9c(a9f);
await carregou9c(a9f);
const idA9f = await a9f.evaluate(() => { dfato('smoke.9f.antesDeRecarregar'); return DIAG_ABERTURA.id; });
await a9f.reload({ waitUntil: 'domcontentloaded' });
await pronta9c(a9f);
await carregou9c(a9f);
const rA9f = await voltou9f(a9f, idA9f, 'smoke.9f.antesDeRecarregar');
const gA9f = await guardado9c(a9f);
diz('RECARREGAR (sem ir pro fundo antes) não perde a abertura: ela volta com o diário até o fim, e foi pra base',
  rA9f.tem && rA9f.marca && gA9f.abertas.some((a) => a.id === idA9f), JSON.stringify({ rA9f, gA9f }));
diz('e o retrato saiu do localStorage ao ir pra base', rA9f.retratosNoAparelho === 0, JSON.stringify(rA9f));

// 2. FECHAR a aba, direto — e olhar o aparelho ANTES de o app reabrir.
const idB9f = await a9f.evaluate(() => { dfato('smoke.9f.antesDeFechar'); return DIAG_ABERTURA.id; });
await a9f.close({ runBeforeUnload: true });
const vB9f = await olhar9f();
diz('CONTROLE: fechada a aba COM o modo dev, o aparelho visto de fora tem o retrato DESTA abertura (o instrumento enxerga)',
  vB9f.app === false && vB9f.retratos.length === 1 && vB9f.retratos[0].endsWith(':' + idB9f), JSON.stringify(vB9f));
const c9f = await abrir9f('reaberta');
await pronta9c(c9f);
await carregou9c(c9f);
const rB9f = await voltou9f(c9f, idB9f, 'smoke.9f.antesDeFechar');
diz('FECHAR a aba (sem ir pro fundo antes) não perde a abertura: reaberta, ela volta com o diário até o fim',
  rB9f.tem && rB9f.marca && rB9f.retratosNoAparelho === 0, JSON.stringify(rB9f));

// 3. O "Sair" apaga o retrato que estiver no aparelho.
await c9f.evaluate(() => localStorage.setItem('waze_places_diag_retrato:plantado', JSON.stringify({ id: 'plantado', salvoEm: Date.now(), diario: [{ t: 1, k: 'x' }] })));
await c9f.evaluate(() => { handleLogout(); });
const sairou9f = await esperarNaPagina(c9f, () => !Object.keys(localStorage).some((k) => k.startsWith('waze_places_diag_retrato')), 5000, 100);
diz('o SAIR apaga o retrato do fechar', sairou9f.ok, JSON.stringify(sairou9f));
await c9f.close({ runBeforeUnload: true });

// 4. Modo dev DESLIGADO: fechar direto não escreve NADA no aparelho.
const prep9f2 = await abrir9f('preparo 2');
await esperarNaPagina(prep9f2, () => typeof API !== 'undefined', 20000, 100);
await prep9f2.evaluate(() => {
  API.setSession('tok-9f');
  localStorage.setItem('waze_places_preferences', JSON.stringify({ comoFuncionaVisto: true, undoEnabled: true }));
  localStorage.setItem('waze_places_devmode', JSON.stringify({ unlocked: true, active: false }));
});
await prep9f2.close({ runBeforeUnload: true });
const d9f = await abrir9f('modo dev desligado');
await pronta9c(d9f);
await d9f.evaluate(() => dfato('smoke.9f.semDev'));
await d9f.close({ runBeforeUnload: true });
const vD9f = await olhar9f();
diz('com o modo dev DESLIGADO, fechar direto não escreve nada no aparelho — nem retrato, nem base',
  vD9f.app === false && vD9f.retratos.length === 0 && vD9f.base === false, JSON.stringify(vD9f));
await ctx9f.close();

secao('9h. A ORIGEM FORA DO AR E A REDE QUE NÃO ANDA: a fila guardada entra com o `onLine` verdadeiro');
// Auditoria de 2026-09-29 (O1). O "Disponível offline" só cobria o modo avião,
// e duas falhas deixavam a fila preparada no aparelho sem uso:
//  · o APP só a abria com `onLine === false`. No "lie-fi" (o rádio diz que há
//    rede e nada passa) a busca esperava o teto de 45 s e a tela virava "Falha
//    ao carregar". Aqui o lie-fi é a forma RÁPIDA da mesma falha: a API aborta
//    sem resposta com o `onLine` verdadeiro — o `_post` trata igual ao teto
//    estourado (`transient`). O teto de 45 s mediu-se à parte (cenário h2).
//  · o SERVICE WORKER só caía no cache em erro de REDE: a VM fora do ar atrás
//    do Cloudflare responde "502 Bad Gateway", a resposta CHEGA e era devolvida.
//    Um proxy na frente do servidor faz o papel da borda. E a navegação sozinha
//    não bastava: com ela, a página guardada abria e os scripts vinham 502.
// CONTROLES: (1) a mesma falha com o offline DESLIGADO é a tela de falha — o
// instrumento enxerga a tela quando não há o que abrir; (2) com a borda em 502,
// o `?diag-rede` (que o worker não intercepta) volta 502 — a origem está MESMO
// fora, e o app que abriu veio do cache.
let borda9h = 'normal';
const proxy9h = http.createServer((req, res) => {
  if (borda9h === '502') {
    res.writeHead(502, { 'content-type': 'text/html' });
    return res.end('<html><body><h1>502 Bad Gateway</h1><p>borda: origem fora do ar</p></body></html>');
  }
  const up = http.request({ host: '127.0.0.1', port: PORTA, path: req.url, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(up);
});
await new Promise((ok) => proxy9h.listen(0, '127.0.0.1', ok));
const BASE9H = `http://127.0.0.1:${proxy9h.address().port}`;
const ctx9h = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', serviceWorkers: 'allow' });
await ctx9h.route('**/*-tiles/live/base/**', servirTile);
// A API desta seção: 'ok' traz 3; 'rede' aborta sem resposta (com o `onLine`
// verdadeiro); '502' é a página de erro da borda (o corpo não é JSON).
let api9h = 'ok';
// As áreas do perfil (a caixa de "Minha área", parte 3): sem área até lá.
let areas9h = [];
const PED_9H = [171, 172, 173].map((i) => SO_MAPA(i));
await ctx9h.route('**/api/*', (r) => {
  if (api9h === 'rede') return r.abort('connectionreset');
  if (api9h === '502') return r.fulfill({ status: 502, contentType: 'text/html', body: '<h1>502 Bad Gateway</h1>' });
  const rota = r.request().url().split('/api/')[1];
  const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (rota === 'buscar-places') return json({ success: true, places: PED_9H, hasMore: false, page: 1, total: 3 });
  if (rota === 'perfil') return json({ success: true, profile: { id: 1, userName: 'e', rank: 5, isAreaManager: true, isStaff: false, editableCountryIDs: [30], areas: areas9h } });
  return r.abort('failed');
});
const abrir9h = async (nome) => {
  const pg = await ctx9h.newPage();
  pg.on('pageerror', (e) => errosJs.push({ secao: secaoAtual + ` [${nome}]`, txt: String(e.message) }));
  pg.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text()))
    violacoes.push({ secao: secaoAtual + ` [${nome}]`, txt: m.text() }); });
  await pg.goto(BASE9H + '/', { waitUntil: 'domcontentloaded' });
  return pg;
};
// O que a tela mostra: o card, a tela de falha, ou nada ainda.
const tela9h = (pg) => pg.evaluate(() => {
  const erro = document.getElementById('loadErrorState');
  return { app: typeof AppState !== 'undefined', onLine: navigator.onLine,
    fila: typeof AppState !== 'undefined' ? AppState.queue.map((p) => p.venueID) : null,
    card: typeof cardDaFrente === 'function' && !!cardDaFrente(),
    falha: !!erro && !erro.classList.contains('hidden'),
    abriu: typeof dfatoAnel !== 'undefined' ? (dfatoAnel.find((e) => e.k === 'offline.abriu') || null) : null };
});
const decidiu9h = (pg) => esperarNaPagina(pg, () => typeof AppState !== 'undefined'
  && (!!cardDaFrente() || !document.getElementById('loadErrorState').classList.contains('hidden')), 20000, 200);
const ESPERADA_9H = JSON.stringify(PED_9H.map((p) => p.venueID));

// Preparo: com a origem de pé, o worker assume, a busca traz 3 e o offline os guarda.
const prep9h = await abrir9h('preparo');
await esperarNaPagina(prep9h, () => !!(navigator.serviceWorker && navigator.serviceWorker.controller), 20000, 100);
await prep9h.evaluate(() => {
  API.setSession('tok-9h');
  localStorage.setItem('waze_places_conta', JSON.stringify({ id: '1', s: marcaDaSessao('tok-9h') }));
  AppState.preferences.offlineDisponivel = true; AppState.preferences.comoFuncionaVisto = true; savePreferences();
});
await prep9h.reload({ waitUntil: 'domcontentloaded' });
const guardou9h = await esperarNaPagina(prep9h, async () => typeof offlineLerFila === 'function'
  && ((await offlineLerFila()) || {}).places?.length === 3, 20000, 200);
diz('PRÉ-CONDIÇÃO: com a origem de pé, o worker assumiu e a fila da busca foi guardada (3)', guardou9h.ok, JSON.stringify(guardou9h));
await prep9h.close({ runBeforeUnload: true });

// 1. A REDE QUE NÃO ANDA: a API não responde, e o aparelho diz que há rede.
api9h = 'rede';
const p1_9h = await abrir9h('lie-fi');
await decidiu9h(p1_9h);
const t1_9h = await tela9h(p1_9h);
diz('a API sem resposta com o `onLine` verdadeiro: a fila guardada entra — nada de "Falha ao carregar"',
  t1_9h.onLine === true && t1_9h.card && !t1_9h.falha && JSON.stringify(t1_9h.fila) === ESPERADA_9H
  && !!t1_9h.abriu && t1_9h.abriu.aposFalha === true, JSON.stringify(t1_9h));
// CONTROLE (1): o mesmo, com o offline DESLIGADO (a preferência gravada; a fila
// guardada fica na base, mas não é dele) — a tela de falha.
await p1_9h.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('waze_places_preferences') || '{}');
  p.offlineDisponivel = false;
  localStorage.setItem('waze_places_preferences', JSON.stringify(p));
});
await p1_9h.close({ runBeforeUnload: true });
const c1_9h = await abrir9h('controle, offline desligado');
await decidiu9h(c1_9h);
const tc_9h = await tela9h(c1_9h);
diz('CONTROLE: a mesma falha com o offline DESLIGADO é a tela de falha (o instrumento enxerga a tela)',
  tc_9h.falha && !tc_9h.card && tc_9h.fila && tc_9h.fila.length === 0, JSON.stringify(tc_9h));
await c1_9h.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('waze_places_preferences') || '{}');
  p.offlineDisponivel = true;
  localStorage.setItem('waze_places_preferences', JSON.stringify(p));
});
await c1_9h.close({ runBeforeUnload: true });

// 2. A ORIGEM FORA DO AR: 502 em TUDO (a página, os scripts, a API).
borda9h = '502'; api9h = '502';
const p2_9h = await abrir9h('borda 502');
await decidiu9h(p2_9h);
const t2_9h = await tela9h(p2_9h);
diz('a ORIGEM fora do ar (502 em tudo): o app instalado abre da cópia guardada, e a fila guardada entra',
  t2_9h.app && t2_9h.card && !t2_9h.falha && JSON.stringify(t2_9h.fila) === ESPERADA_9H, JSON.stringify(t2_9h));
const diag9h = await p2_9h.evaluate(async () => { try { return (await fetch('/?diag-rede=1')).status; } catch (e) { return 'erro'; } });
diz('CONTROLE: com a borda em 502, o que não passa pelo worker volta 502 — a origem está mesmo fora', diag9h === 502, `status ${diag9h}`);
await p2_9h.close();
borda9h = 'normal'; api9h = 'ok';

// 3. COM "MINHA ÁREA" (auditoria da rodada 12, R12-4-02). A busca de "Minha área"
// não sai sem o perfil (a caixa vem dele): ela ESPERA, e a espera não marcava a
// falha por rede — a abertura com a API sem resposta, ou com a origem fora do ar,
// terminava em "Falha ao carregar" com a fila guardada DESTE filtro no aparelho
// (MEDIDO, n9 da auditoria). A fila guardada aqui é a de uma busca de "Minha
// área" com rede; o PRÉ-REQUISITO de cada parte é a busca ter esperado o perfil.
areas9h = [{ type: 'drive', bbox: [-43.5, -23.2, -42.9, -22.6] }];
const prepM9h = await abrir9h('preparo, Minha área');
await esperarNaPagina(prepM9h, () => typeof AppState !== 'undefined' && AppState.authenticated && !!AppState.profile, 20000, 100);
await prepM9h.evaluate(() => { AppState.filters.myArea = true; saveFilters(); });
await prepM9h.reload({ waitUntil: 'domcontentloaded' });
const guardouM9h = await esperarNaPagina(prepM9h, async () => typeof offlineLerFila === 'function'
  && AppState.filters.myArea === true && !!AppState.profile && !!cardDaFrente()
  && ((await offlineLerFila()) || {}).busca === assinaturaDeBusca(true), 20000, 200);
diz('PRÉ-CONDIÇÃO: com "Minha área" e a origem de pé, a fila da busca de "Minha área" foi guardada', guardouM9h.ok,
  JSON.stringify(guardouM9h));
await prepM9h.close({ runBeforeUnload: true });
const minhaArea9h = (pg) => pg.evaluate(() => ({ myArea: AppState.filters.myArea, perfil: !!AppState.profile,
  esperou: dfatoAnel.some((e) => e.k === 'busca.esperaPerfil') }));
api9h = 'rede';
const p3_9h = await abrir9h('Minha área, lie-fi');
await decidiu9h(p3_9h);
const t3_9h = await tela9h(p3_9h);
const m3_9h = await minhaArea9h(p3_9h);
diz('com "Minha área" e a API sem resposta (`onLine` verdadeiro), a busca espera o perfil — e a fila guardada entra (R12-4-02)',
  m3_9h.myArea === true && !m3_9h.perfil && m3_9h.esperou && t3_9h.card && !t3_9h.falha
  && JSON.stringify(t3_9h.fila) === ESPERADA_9H && !!t3_9h.abriu && t3_9h.abriu.aposFalha === true,
  JSON.stringify({ t3_9h, m3_9h }));
await p3_9h.close({ runBeforeUnload: true });
borda9h = '502'; api9h = '502';
const p4_9h = await abrir9h('Minha área, borda 502');
await decidiu9h(p4_9h);
const t4_9h = await tela9h(p4_9h);
const m4_9h = await minhaArea9h(p4_9h).catch(() => null);
diz('com "Minha área" e a ORIGEM fora do ar (502 em tudo), a fila guardada entra (R12-4-02)',
  t4_9h.app && !!m4_9h && m4_9h.myArea === true && m4_9h.esperou && t4_9h.card && !t4_9h.falha
  && JSON.stringify(t4_9h.fila) === ESPERADA_9H, JSON.stringify({ t4_9h, m4_9h }));
await p4_9h.close();
borda9h = 'normal'; api9h = 'ok'; areas9h = [];
await ctx9h.close();
await new Promise((ok) => proxy9h.close(ok));

secao('9i. DUAS ABAS E A REDE VOLTANDO: cada decisão da fila de saída sai UMA vez');
// Auditoria de 2026-09-29 (O6). A trava do esvaziamento era da ABA, e a fila de
// saída é do APARELHO: com o app em duas abas, a rede voltando manda o `online`
// às duas, e as duas esvaziavam a MESMA fila — cada decisão saía duas vezes pro
// Waze e o pouso contava nas duas (medido: 3 decisões, 5 rejeitados no
// Histórico). Hoje a trava do navegador (`navigator.locks`) deixa uma aba
// esvaziar; sem ela (navegador antigo) cada item é REIVINDICADO antes do envio.
// Duas páginas do MESMO contexto: o armazenamento e a trava são os do aparelho.
// CONTROLE: a mesma fila com UMA aba — cada decisão sai e conta uma vez.
const cenario9i = async (nome, abas, semTravas) => {
  const ctx9i = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', serviceWorkers: 'block' });
  if (semTravas) await ctx9i.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'locks', { get: () => undefined, configurable: true }); });
  let aviao9i = false;
  const decisoes = [];
  await ctx9i.route('**/api/*', async (r) => {
    if (aviao9i) return r.abort('internetdisconnected');
    const rota = r.request().url().split('/api/')[1];
    let corpo = {};
    try { corpo = JSON.parse(r.request().postData() || '{}'); } catch (e) { /* corpo vazio */ }
    const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (rota === 'buscar-places') return json({ success: true, places: [SO_MAPA(190)], hasMore: false, page: 1, total: 1 });
    if (rota === 'validar-place' || rota === 'marcar-lido') {
      const k = corpo.venueID + '|' + corpo.updateRequestID;
      const repetida = decisoes.includes(k);
      decisoes.push(k);
      await dormir(repetida ? 900 : 150);
      // A 2ª decisão do mesmo pedido é o Waze dizendo "já tratado" (702).
      return json(repetida ? { success: false, errorCategory: 'already_processed' } : { success: true });
    }
    if (rota === 'perfil') return json({ success: true, profile: { id: 1, userName: 'e', rank: 5, isAreaManager: true, isStaff: false, editableCountryIDs: [30], areas: [] } });
    return r.abort('failed');
  });
  const pags = [];
  for (let i = 0; i < abas; i++) {
    const pg = await ctx9i.newPage();
    pg.on('pageerror', (e) => errosJs.push({ secao: secaoAtual + ` [${nome} ${i}]`, txt: String(e.message) }));
    await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    pags.push(pg);
  }
  await esperarNaPagina(pags[0], () => typeof API !== 'undefined', 20000, 100);
  await pags[0].evaluate(() => {
    API.setSession('tok-9i');
    localStorage.setItem('waze_places_conta', JSON.stringify({ id: '1', s: marcaDaSessao('tok-9i') }));
    AppState.preferences.comoFuncionaVisto = true; savePreferences();
    localStorage.removeItem('waze_places_history'); localStorage.removeItem('waze_places_saida');
  });
  for (const pg of pags) await pg.reload({ waitUntil: 'domcontentloaded' });
  for (const pg of pags) await esperarNaPagina(pg, () => typeof AppState !== 'undefined' && AppState.authenticated && !!cardDaFrente(), 20000, 100);
  const travas = await pags[0].evaluate(() => !!(navigator.locks && navigator.locks.request));
  // Sem rede: três ✕ vão pra fila de saída (gravados como a fila de saída grava).
  aviao9i = true; await ctx9i.setOffline(true);
  await pags[0].evaluate(() => {
    for (const i of [1, 2, 3]) enfileirarSaida('reject', { venueID: 'w' + i, updateRequestID: 'x' + i, creatorId: 777, createdBy: 'autor' });
  });
  const naFila = await pags[0].evaluate(() => JSON.parse(localStorage.getItem('waze_places_saida') || '[]').length);
  // A rede volta: o navegador avisa TODAS as abas.
  aviao9i = false; await ctx9i.setOffline(false);
  for (const pg of pags) await esperarFimDaSaida(pg, 20000);
  await dormir(1500);   // a decisão repetida, se houver, pousa em 900 ms
  const porPedido = {};
  for (const k of decisoes) porPedido[k] = (porPedido[k] || 0) + 1;
  const hist = await pags[0].evaluate(() => ({
    rejeitados: (JSON.parse(localStorage.getItem('waze_places_history') || '{}')._total || {}).rejected || 0,
    fila: JSON.parse(localStorage.getItem('waze_places_saida') || '[]').length }));
  await ctx9i.close();
  return { travas, naFila, porPedido, hist };
};
const duas9i = await cenario9i('com a trava', 2, false);
diz('PRÉ-CONDIÇÃO: o navegador tem a trava entre abas, e 3 decisões esperam na fila de saída',
  duas9i.travas === true && duas9i.naFila === 3, JSON.stringify(duas9i));
diz('duas abas e a rede voltando: cada decisão saiu UMA vez pro Waze',
  Object.keys(duas9i.porPedido).length === 3 && Object.values(duas9i.porPedido).every((n) => n === 1), JSON.stringify(duas9i.porPedido));
diz('e o Histórico contou 3 rejeitados (não em dobro), com a fila vazia',
  duas9i.hist.rejeitados === 3 && duas9i.hist.fila === 0, JSON.stringify(duas9i.hist));
const reserva9i = await cenario9i('sem a trava', 2, true);
diz('PRÉ-CONDIÇÃO: sem `navigator.locks` (a reserva) de fato — 3 decisões esperando',
  reserva9i.travas === false && reserva9i.naFila === 3, JSON.stringify(reserva9i));
diz('sem a trava do navegador, cada item REIVINDICADO sai uma vez e conta uma vez',
  Object.keys(reserva9i.porPedido).length === 3 && Object.values(reserva9i.porPedido).every((n) => n === 1)
  && reserva9i.hist.rejeitados === 3 && reserva9i.hist.fila === 0, JSON.stringify(reserva9i));
const uma9i = await cenario9i('controle', 1, false);
diz('CONTROLE: uma aba só — cada decisão sai e conta uma vez (o instrumento conta certo)',
  Object.keys(uma9i.porPedido).length === 3 && Object.values(uma9i.porPedido).every((n) => n === 1)
  && uma9i.hist.rejeitados === 3, JSON.stringify(uma9i));

secao('9j. A FOTO QUEBRADA NO FIM DA FILA, E O CARD DE FOTO NO LIE-FI');
// Auditoria de 2026-09-30.
// (R5-4-1) A foto que falha sempre e é a ÚLTIMA a falhar (a do último pedido,
// um 404 mais lento que o resto) deixava a preparação "parcial" PRA SEMPRE: ela
// só virava "defeito do item" se OUTRO item terminasse com sucesso entre a 1ª e
// a 3ª tentativa dela, e atrás da última não há ninguém. A janela não virava e
// cada prova de rede refazia a lista inteira. Hoje a varredura PERGUNTA à rede
// (um tile desta fila, `no-cache`) antes de culpá-la — aqui com a CSP e o
// service worker de verdade no caminho da pergunta. CONTROLE: a rede caindo
// logo depois da 1ª falha da foto — a sonda diz que não, e fica "parcial" (a
// sonda não inocenta tudo).
// (R5-4-4) A fila guardada aberta pelo lie-fi (`onLine` verdadeiro, a busca sem
// resposta) mostrava o card de foto sem a foto com "Sem Imagem" e ✕/✓ VIVOS —
// no modo avião o mesmo card trava. CONTROLE: com a foto chegando, o mesmo card
// abre sem trava (a trava vem da foto que falhou, não da reabertura).
const PERFIL_9J = { success: true, profile: { id: 1, userName: 'e', rank: 5, isAreaManager: true, isStaff: false, editableCountryIDs: [30], areas: [] } };
const abrir9j = async (ctx, nome) => {
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errosJs.push({ secao: secaoAtual + ` [${nome}]`, txt: String(e.message) }));
  pg.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text()))
    violacoes.push({ secao: secaoAtual + ` [${nome}]`, txt: m.text() }); });
  await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  return pg;
};
const entrar9j = async (pg, tok) => {
  await esperarNaPagina(pg, () => !!(navigator.serviceWorker && navigator.serviceWorker.controller), 20000, 100);
  await pg.evaluate((t) => {
    API.setSession(t);
    localStorage.setItem('waze_places_conta', JSON.stringify({ id: '1', s: marcaDaSessao(t) }));
    AppState.preferences.offlineDisponivel = true; AppState.preferences.comoFuncionaVisto = true; savePreferences();
  }, tok);
  await pg.reload({ waitUntil: 'domcontentloaded' });
};
// Uma fila de 12 pedidos com foto; a do ÚLTIMO responde 404, depois do resto.
const PED_9J = Array.from({ length: 12 }, (_, i) => ({ ...PLACE(181 + i),
  mapa: { centro: [-22.9 + i * 0.05, -43.2 + i * 0.05], entradas: [] } }));
const FOTO_RUIM_9J = PED_9J.at(-1).imageUrls[0];
const preparar9j = async (nome, { redeCaiNaFoto }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', serviceWorkers: 'allow' });
  const conta = { tiles: 0, fotoRuim: 0, rede: true };
  await ctx.route('**/*-tiles/live/base/**', async (r) => {
    if (!conta.rede) return r.abort('connectionreset');
    await dormir(30);
    conta.tiles++;
    return r.fulfill({ status: 200, contentType: 'image/png', body: PX,
      headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=600' } });
  });
  await ctx.route('**/venue-image.waze.com/**', async (r) => {
    if (r.request().url().startsWith(FOTO_RUIM_9J)) {
      conta.fotoRuim++;
      if (redeCaiNaFoto) conta.rede = false;
      await dormir(300);
      return r.fulfill({ status: 404, body: 'nao' });
    }
    if (!conta.rede) return r.abort('connectionreset');
    return r.fulfill({ status: 200, contentType: 'image/png', body: PX, headers: { 'cache-control': 'public, max-age=3600' } });
  });
  await ctx.route('**/api/*', (r) => {
    const rota = r.request().url().split('/api/')[1];
    const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (rota === 'buscar-places') return json({ success: true, places: PED_9J, hasMore: false, page: 1, total: PED_9J.length });
    if (rota === 'perfil') return json(PERFIL_9J);
    return r.abort('failed');
  });
  const pg = await abrir9j(ctx, nome);
  await entrar9j(pg, 'tok-9j');
  const fim = await esperarNaPagina(pg, () => typeof offlineUltimoResultado !== 'undefined'
    && offlineUltimoResultado !== null && !offlineVarrendo, 60000, 200);
  const r = await pg.evaluate(() => {
    const ev = dfatoAnel.filter((e) => e.k === 'offline.pronto' || e.k === 'offline.parcial').at(-1) || null;
    return { resultado: offlineUltimoResultado, janela: offlineJanelaServida,
      ev: ev && { k: ev.k, sondas: ev.sondas || 0, definitivos: ev.definitivos || 0 } };
  });
  return { ctx, pg, conta, fim: fim.ok, ...r };
};

// 1. A foto quebrada é a ÚLTIMA, e a rede está de pé.
const a9j = await preparar9j('foto quebrada no fim', { redeCaiNaFoto: false });
diz('PRÉ-CONDIÇÃO: a varredura terminou, e a foto quebrada foi tentada até esgotar (3 vezes)',
  a9j.fim && a9j.conta.fotoRuim === 3, JSON.stringify({ fim: a9j.fim, fotoRuim: a9j.conta.fotoRuim }));
diz('a foto quebrada no FIM da fila: a sonda pergunta à rede (UMA vez) e a preparação fica PRONTA, com a janela virada',
  a9j.resultado === 'pronto' && a9j.janela !== null && !!a9j.ev && a9j.ev.k === 'offline.pronto'
  && a9j.ev.sondas === 1 && a9j.ev.definitivos >= 1, JSON.stringify({ resultado: a9j.resultado, janela: a9j.janela, ev: a9j.ev }));
// E a prova de rede seguinte (a resposta de uma ação) não refaz a varredura.
const tiles9j = a9j.conta.tiles;
await a9j.pg.evaluate(() => { offlineMarcarGesto(); API.aoProvarRede && API.aoProvarRede('validar-place'); });
await dormir(300);
await esperarNaPagina(a9j.pg, () => !offlineVarrendo, 30000, 100);
diz('e a prova de rede seguinte não pede tile nenhum (era a lista INTEIRA a cada uma)',
  a9j.conta.tiles === tiles9j, `tiles: ${tiles9j} → ${a9j.conta.tiles}`);
await a9j.ctx.close();

// CONTROLE: a rede CAI logo depois da 1ª falha da foto — a sonda diz que não.
const c9j = await preparar9j('controle, a rede cai', { redeCaiNaFoto: true });
// (No máximo UMA sonda: a resposta negativa vale pros itens que esgotam depois.)
diz('CONTROLE: com a rede caindo no meio, a preparação fica PARCIAL — a sonda não inocenta tudo',
  c9j.fim && c9j.resultado === 'parcial' && !!c9j.ev && c9j.ev.k === 'offline.parcial' && c9j.ev.sondas <= 1,
  JSON.stringify({ resultado: c9j.resultado, ev: c9j.ev }));
await c9j.ctx.close();

// 2. O card de FOTO na fila guardada aberta pelo LIE-FI.
const liefi9j = async (nome, { fotoChega }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', serviceWorkers: 'allow' });
  const estado = { liefi: false };
  const pedidos = [PLACE(201, 'NEW_PHOTO'), SO_MAPA(202)];
  await ctx.route('**/*-tiles/live/base/**', (r) => (estado.liefi ? r.abort('connectionreset')
    : r.fulfill({ status: 200, contentType: 'image/png', body: PX, headers: { 'access-control-allow-origin': '*' } })));
  await ctx.route('**/venue-image.waze.com/**', (r) => ((estado.liefi && !fotoChega) ? r.abort('connectionreset')
    : r.fulfill({ status: 200, contentType: 'image/png', body: PX })));
  await ctx.route('**/api/*', (r) => {
    if (estado.liefi) return r.abort('connectionreset');
    const rota = r.request().url().split('/api/')[1];
    const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (rota === 'buscar-places') return json({ success: true, places: pedidos, hasMore: false, page: 1, total: 2 });
    if (rota === 'perfil') return json(PERFIL_9J);
    return r.abort('failed');
  });
  const prep = await abrir9j(ctx, nome + ', preparo');
  await entrar9j(prep, 'tok-9j-foto');
  const pronto = await esperarNaPagina(prep, () => typeof offlineUltimoResultado !== 'undefined'
    && offlineUltimoResultado === 'pronto' && !offlineVarrendo, 30000, 200);
  await prep.close({ runBeforeUnload: true });
  // Reaberto no lie-fi: a API sem resposta, e o aparelho dizendo que há rede.
  estado.liefi = true;
  const pg = await abrir9j(ctx, nome);
  await esperarNaPagina(pg, () => typeof AppState !== 'undefined' && !!cardDaFrente()
    && !!AppState.currentPlace && AppState.currentPlace.venueID === 'v201', 30000, 200);
  // A foto decide: ou carregou, ou falhou (e então o card já reagiu).
  await esperarNaPagina(pg, () => { const i = cardDaFrente() && cardDaFrente().querySelector('.card-image');
    return !!i && (i.classList.contains('hidden') || (i.complete && i.naturalWidth > 0)); }, 15000, 100);
  await dormir(300);
  const t = await pg.evaluate(() => {
    const c = cardDaFrente();
    const b = (s) => !!(c.querySelector(s) && c.querySelector(s).disabled);
    return { onLine: navigator.onLine, abriu: (dfatoAnel.find((e) => e.k === 'offline.abriu') || {}).aposFalha === true,
      aviso: !!c.querySelector('.card-sem-foto'), rejeitar: b('.card-btn-reject'), lido: b('.card-btn-read'), pular: b('.card-btn-skip') };
  });
  await ctx.close();
  return { pronto: pronto.ok, ...t };
};
const l9j = await liefi9j('lie-fi, a foto não vem', { fotoChega: false });
diz('PRÉ-CONDIÇÃO: preparado com rede, e reaberto no lie-fi (`onLine` verdadeiro) pela fila guardada',
  l9j.pronto && l9j.onLine === true && l9j.abriu, JSON.stringify(l9j));
diz('no lie-fi, o card de foto cuja foto não veio TRAVA ✕ e ✓ e diz que precisa de sinal (o ↑ fica vivo)',
  l9j.aviso && l9j.rejeitar && l9j.lido && !l9j.pular, JSON.stringify(l9j));
const lc9j = await liefi9j('controle, a foto chega', { fotoChega: true });
diz('CONTROLE: no mesmo lie-fi, com a foto chegando, o card abre sem trava',
  lc9j.pronto && lc9j.abriu && !lc9j.aviso && !lc9j.rejeitar && !lc9j.lido, JSON.stringify(lc9j));

// 3. (R9-4-06) A REDE PROVADA ANTES de a prova da foto começar. O mesmo lie-fi:
// a abertura com o `onLine` verdadeiro, a busca sem resposta, a fila guardada e
// o card de foto travado. A PRIMEIRA resposta nossa (o perfil, segurado aqui) é
// quem chama a recuperação — já com a rede provada —, e o 1º pedido à foto fica
// PRESO. Ela começava uma prova da <img> mesmo assim, e o card ficava travado
// até o teto (MEDIDO, n4 da auditoria da rodada 9: 10,1 s; com a prova já no ar,
// 11 ms). A PRÉ-CONDIÇÃO é o CONTROLE: com o perfil segurado (nada provando a
// rede), o card segue travado.
const ctxP9j = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', serviceWorkers: 'allow' });
const p9j = { fase: 'prepara', perfis: [], fotos: [] };
const pedidosP9j = [PLACE(211, 'NEW_PHOTO'), SO_MAPA(212)];
await ctxP9j.route('**/*-tiles/live/base/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PX,
  headers: { 'access-control-allow-origin': '*' } }));
await ctxP9j.route('**/venue-image.waze.com/**', (r) => {
  if (p9j.fase === 'prepara') return r.fulfill({ status: 200, contentType: 'image/png', body: PX });
  if (p9j.fase === 'liefi') return r.abort('connectionreset');
  p9j.fotos.push(r); return undefined;                     // 'prova': o pedido à foto fica PRESO
});
await ctxP9j.route('**/api/*', (r) => {
  const rota = r.request().url().split('/api/')[1];
  const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (p9j.fase !== 'prepara') {
    if (rota === 'perfil') { p9j.perfis.push(r); return undefined; }   // a resposta nossa, segurada
    return r.abort('connectionreset');                                 // o lie-fi: nada mais responde
  }
  if (rota === 'buscar-places') return json({ success: true, places: pedidosP9j, hasMore: false, page: 1, total: 2 });
  if (rota === 'perfil') return json(PERFIL_9J);
  return r.abort('failed');
});
const prepP9j = await abrir9j(ctxP9j, 'rede provada antes, preparo');
await entrar9j(prepP9j, 'tok-9j-prova');
const prontoP9j = await esperarNaPagina(prepP9j, () => typeof offlineUltimoResultado !== 'undefined'
  && offlineUltimoResultado === 'pronto' && !offlineVarrendo, 30000, 200);
await prepP9j.close({ runBeforeUnload: true });
p9j.fase = 'liefi';
const pgP9j = await abrir9j(ctxP9j, 'rede provada antes');
const travadoP9j = await esperarNaPagina(pgP9j, () => typeof AppState !== 'undefined' && !!cardDaFrente()
  && !!AppState.currentPlace && AppState.currentPlace.venueID === 'v211' && !!cardDaFrente().querySelector('.card-sem-foto'), 30000, 200);
p9j.fase = 'prova';
await dormir(1000);   // o tempo de um destravamento indevido aparecer, se houvesse
const antesP9j = await pgP9j.evaluate(() => { const c = cardDaFrente();
  return { aviso: !!(c && c.querySelector('.card-sem-foto')), rejeitar: !!(c && c.querySelector('.card-btn-reject').disabled),
    onLine: navigator.onLine }; });
diz('PRÉ-CONDIÇÃO: lie-fi pela fila guardada, o card de foto travado e o perfil SEGURADO — sem nada provando a rede, o card segue travado',
  prontoP9j.ok && travadoP9j.ok && p9j.perfis.length >= 1 && antesP9j.aviso && antesP9j.rejeitar && antesP9j.onLine === true,
  JSON.stringify({ pronto: prontoP9j.ok, travado: travadoP9j.ok, perfis: p9j.perfis.length, antesP9j }));
const tP9j = Date.now();
if (p9j.perfis.length) {
  await p9j.perfis.shift().fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PERFIL_9J) });
}
const soltoP9j = await esperarNaPagina(pgP9j, () => { const c = cardDaFrente();
  return !!(c && !c.querySelector('.card-sem-foto') && !c.querySelector('.card-btn-reject').disabled); }, 15000, 50);
const msP9j = Date.now() - tP9j;
const diarioP9j = await pgP9j.evaluate(() => dfatoAnel.filter((e) => /^foto\./.test(e.k)).map((e) => e.k));
diz('a rede provada ANTES de a prova da foto começar solta o card NA HORA — com o pedido à foto preso (R9-4-06)',
  soltoP9j.ok && msP9j < 2000 && diarioP9j.includes('foto.redeProvada') && !diarioP9j.includes('foto.provaSemResposta'),
  JSON.stringify({ ms: msP9j, solto: soltoP9j.ok, diario: diarioP9j, fotosPresas: p9j.fotos.length }));
for (const r of p9j.fotos.splice(0)) await r.fulfill({ status: 404, body: 'nao' }).catch(() => {});
for (const r of p9j.perfis.splice(0)) await r.abort('failed').catch(() => {});
await ctxP9j.close();

// 4 e 5. O MESMO lie-fi de cima, com o que a pessoa (e o app) fazem no meio
// (auditoria da rodada 10). O 3 acima é o CONTROLE dos dois: sem nada no meio, o
// perfil que responde solta o card na hora.
//  · (R10-4-01) A pessoa tenta ARRASTAR o card travado — a reação natural a ✕ e
//    ✓ apagados — e solta: a direção está travada, ele volta pro lugar, e a volta
//    deixa `translate(0, 0) rotate(0deg)` escrito. A recuperação lia esse
//    transform como "arraste em curso" e desistia: o card nunca mais saía do
//    aviso (MEDIDO, n4b: 15 s e contando; n23, o mesmo no modo avião).
//  · (R10-4-03) Uma decisão de antes ESPERA envio, e o esvaziamento da abertura
//    fica no ar com ela pendurada: o perfil responde NO MEIO dele, e a prova de
//    rede saía cedo antes de soltar o card (MEDIDO, n14: 15,9 s e contando).
const liefiSegurado9j = async (nome, { comSaida = false } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', serviceWorkers: 'allow' });
  const e = { fase: 'prepara', perfis: [], fotos: [], saidas: [] };
  const pedidos = [PLACE(221, 'NEW_PHOTO'), SO_MAPA(222)];
  await ctx.route('**/*-tiles/live/base/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PX,
    headers: { 'access-control-allow-origin': '*' } }));
  await ctx.route('**/venue-image.waze.com/**', (r) => {
    if (e.fase === 'prepara') return r.fulfill({ status: 200, contentType: 'image/png', body: PX });
    if (e.fase === 'liefi') return r.abort('connectionreset');
    e.fotos.push(r); return undefined;                         // 'prova': o pedido à foto fica PRESO
  });
  await ctx.route('**/api/*', (r) => {
    const rota = r.request().url().split('/api/')[1];
    const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (e.fase !== 'prepara') {
      if (rota === 'perfil') { e.perfis.push(r); return undefined; }          // a resposta nossa, segurada
      if (rota === 'validar-place') { e.saidas.push(r); return undefined; }   // a decisão do esvaziamento, pendurada
      return r.abort('connectionreset');                                     // o lie-fi: nada mais responde
    }
    if (rota === 'buscar-places') return json({ success: true, places: pedidos, hasMore: false, page: 1, total: 2 });
    if (rota === 'perfil') return json(PERFIL_9J);
    return r.abort('failed');
  });
  const prep = await abrir9j(ctx, nome + ', preparo');
  await entrar9j(prep, 'tok-9j-' + nome.replace(/\W+/g, ''));
  const pronto = await esperarNaPagina(prep, () => typeof offlineUltimoResultado !== 'undefined'
    && offlineUltimoResultado === 'pronto' && !offlineVarrendo, 30000, 200);
  // A decisão de ANTES, esperando envio (um pedido que não está na fila guardada).
  if (comSaida) await prep.evaluate(() => enfileirarSaida('reject', { venueID: 'v229', updateRequestID: 'u229', creatorId: 229 }, 'row'));
  await prep.close({ runBeforeUnload: true });
  e.fase = 'liefi';
  const pg = await abrir9j(ctx, nome);
  const travado = await esperarNaPagina(pg, () => typeof AppState !== 'undefined' && !!cardDaFrente()
    && !!AppState.currentPlace && AppState.currentPlace.venueID === 'v221' && !!cardDaFrente().querySelector('.card-sem-foto'), 30000, 200);
  const estado = () => pg.evaluate(() => { const c = cardDaFrente();
    return { aviso: !!(c && c.querySelector('.card-sem-foto')), rejeitar: !!(c && c.querySelector('.card-btn-reject').disabled),
      transform: c ? c.style.transform : null, rejeitados: AppState.stats.rejected, esvaziando: esvaziandoSaida,
      saida: carregarFilaDeSaida().length }; });
  // O perfil segurado RESPONDE (a prova de rede) e mede quanto o card leva pra sair do aviso.
  const provar = async () => {
    const t0 = Date.now();
    if (e.perfis.length) await e.perfis.shift().fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PERFIL_9J) });
    const solto = await esperarNaPagina(pg, () => { const c = cardDaFrente();
      return !!(c && !c.querySelector('.card-sem-foto') && !c.querySelector('.card-btn-reject').disabled); }, 15000, 50);
    return { solto: solto.ok, ms: Date.now() - t0, diario: await pg.evaluate(() => dfatoAnel.filter((x) => /^foto\./.test(x.k)).map((x) => x.k)) };
  };
  const fechar = async () => {
    for (const r of [...e.fotos.splice(0), ...e.saidas.splice(0)]) await r.abort('failed').catch(() => {});
    for (const r of e.perfis.splice(0)) await r.abort('failed').catch(() => {});
    await ctx.close();
  };
  return { ctx, pg, e, pronto: pronto.ok, travado: travado.ok, estado, provar, fechar };
};

// 4. (R10-4-01) O ARRASTE: a pessoa arrasta o card travado 160 px pra direita e solta.
const a9jR = await liefiSegurado9j('arrastou o card travado');
const arr9j = await a9jR.pg.evaluate(() => { const r = cardDaFrente().querySelector('.card-content').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + 30 }; });
// O selo do lado, com o dedo AINDA no card, ASSENTADO (a transição de 0,15 s da
// opacidade termina antes da leitura): é o que a pessoa vê no meio do arraste.
const seloA9j = () => a9jR.pg.evaluate(() => new Promise((ok) => setTimeout(() => {
  const c = cardDaFrente();
  ok({ direita: Number(getComputedStyle(c.querySelector('.swipe-right')).opacity), esquerda: Number(getComputedStyle(c.querySelector('.swipe-left')).opacity) });
}, 350)));
await a9jR.pg.mouse.move(arr9j.x, arr9j.y);
await a9jR.pg.mouse.down();
for (let i = 1; i <= 8; i++) { await a9jR.pg.mouse.move(arr9j.x + 20 * i, arr9j.y); await dormir(30); }
const seloTravadoA9j = await seloA9j();
await a9jR.pg.mouse.up();
// A volta pro lugar acabou (400 ms) — pelo FIM dela (o card parado), não por prazo.
await esperarNaPagina(a9jR.pg, () => !window.gestoNoCard(cardDaFrente()), 5000, 50);
a9jR.e.fase = 'prova';
const antesA9j = await a9jR.estado();
diz('PRÉ-CONDIÇÃO: lie-fi, o card de foto travado, ARRASTADO e de volta ao lugar (o transform de repouso escrito), nada decidido e o perfil segurado',
  a9jR.pronto && a9jR.travado && a9jR.e.perfis.length >= 1 && antesA9j.aviso && antesA9j.rejeitar
  && /^translate\(0(px)?, 0(px)?\) rotate\(0deg\)$/.test(antesA9j.transform || '') && antesA9j.rejeitados === 0,
  JSON.stringify({ pronto: a9jR.pronto, travado: a9jR.travado, perfis: a9jR.e.perfis.length, antesA9j }));
// (R11-4-02) O selo "Lido" acendia inteiro no arraste pro lado travado — e soltar
// não decidia: o que o app MOSTRAVA e o que ele ACEITAVA discordavam (MEDIDO, n29
// da auditoria da rodada 11, nos dois motores).
diz('no card de foto travado, o arraste pro lado NÃO acende o selo daquele lado — soltar ali não decide (R11-4-02)',
  seloTravadoA9j.direita === 0, JSON.stringify(seloTravadoA9j));
const provaA9j = await a9jR.provar();
diz('o card de foto que a pessoa TENTOU ARRASTAR sai do "precisa de sinal" quando a rede é provada (R10-4-01)',
  provaA9j.solto && provaA9j.ms < 2000 && provaA9j.diario.includes('foto.redeProvada'), JSON.stringify(provaA9j));
// CONTROLE do selo: o MESMO arraste no MESMO card, agora solto do aviso, acende o
// "Lido" — e volta pro meio antes de soltar, pra não decidir nada.
await a9jR.pg.mouse.move(arr9j.x, arr9j.y);
await a9jR.pg.mouse.down();
for (let i = 1; i <= 8; i++) { await a9jR.pg.mouse.move(arr9j.x + 20 * i, arr9j.y); await dormir(30); }
const seloLivreA9j = await seloA9j();
for (let i = 7; i >= 0; i--) { await a9jR.pg.mouse.move(arr9j.x + 20 * i, arr9j.y); await dormir(30); }
await dormir(200);
await a9jR.pg.mouse.up();
await esperarNaPagina(a9jR.pg, () => !window.gestoNoCard(cardDaFrente()), 5000, 50);
const fimA9j = await a9jR.pg.evaluate(() => ({ lidos: AppState.stats.read, rejeitados: AppState.stats.rejected,
  frente: AppState.currentPlace && AppState.currentPlace.venueID }));
diz('CONTROLE: o mesmo arraste no card livre acende o "Lido" (o instrumento enxerga o selo), e voltar ao meio não decide',
  seloLivreA9j.direita === 1 && fimA9j.lidos === 0 && fimA9j.rejeitados === 0 && fimA9j.frente === 'v221' && provaA9j.solto,
  JSON.stringify({ seloLivreA9j, fimA9j }));
await a9jR.fechar();

// 5. (R10-4-03) A PROVA NO MEIO DO ESVAZIAMENTO: uma decisão de antes espera
// envio, e o esvaziamento da abertura fica no ar com ela pendurada.
const s9jR = await liefiSegurado9j('prova no meio do esvaziamento', { comSaida: true });
const noAr9j = await esperarNaPagina(s9jR.pg, () => esvaziandoSaida === true, 10000, 50);
for (let i = 0; i < 50 && !s9jR.e.saidas.length; i++) await dormir(100);
s9jR.e.fase = 'prova';
const antesS9j = await s9jR.estado();
diz('PRÉ-CONDIÇÃO: lie-fi, o card de foto travado, o esvaziamento NO AR com a decisão pendurada, e o perfil segurado',
  s9jR.pronto && s9jR.travado && noAr9j.ok && s9jR.e.saidas.length === 1 && s9jR.e.perfis.length >= 1
  && antesS9j.aviso && antesS9j.rejeitar && antesS9j.esvaziando === true,
  JSON.stringify({ pronto: s9jR.pronto, travado: s9jR.travado, noAr: noAr9j.ok, saidas: s9jR.e.saidas.length, perfis: s9jR.e.perfis.length, antesS9j }));
const provaS9j = await s9jR.provar();
const durante9j = await s9jR.estado();
diz('a rede provada NO MEIO do esvaziamento da fila de saída solta o card de foto — com o esvaziamento ainda no ar (R10-4-03)',
  provaS9j.solto && provaS9j.ms < 2000 && durante9j.esvaziando === true && provaS9j.diario.includes('foto.redeProvada'),
  JSON.stringify({ provaS9j, durante9j }));
// E o esvaziamento termina como sempre: a decisão pendurada pousa e a fila de saída esvazia.
if (s9jR.e.saidas.length) await s9jR.e.saidas.shift().fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
const fimS9j = await esperarNaPagina(s9jR.pg, () => !esvaziandoSaida && carregarFilaDeSaida().length === 0, 10000, 50);
diz('e o esvaziamento termina: a decisão de antes pousa e a fila de saída esvazia', fimS9j.ok, JSON.stringify(await s9jR.estado()));
await s9jR.fechar();

secao('9k. DUAS ABAS E O DIAGNÓSTICO: a poda, a outra aba no relatório e a sentinela');
// Auditoria da rodada 7 (R7-4-03, R7-4-04, R7-4-05). Duas páginas do MESMO
// contexto (o mesmo aparelho: a base, a fila de saída e o aviso `storage` são
// os de verdade), a B aberta DEPOIS da A, com o modo dev ligado.
//  · A PODA da base ia pela hora de ABERTURA: a B registrava 12 telas, a A 2 (as
//    mais novas de todas), e na base ficavam A 0 · B 12.
//  · O RELATÓRIO da A trazia a B, VIVA, como "abertura anterior".
//  · A SENTINELA `pedidoDecididoNaFila`: a A decide sem sinal um pedido que a B
//    já tinha na fila, e a captura da B acusava "voltou como card".
const ctx9k = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR',
  serviceWorkers: 'block', acceptDownloads: true });
let aviao9k = false;
await ctx9k.route('**/*-tiles/live/base/**', (r) => (aviao9k ? r.abort('internetdisconnected') : servirTile(r)));
const rotaApi9k = (r) => {
  if (aviao9k) return r.abort('internetdisconnected');
  const rota = r.request().url().split('/api/')[1];
  const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (rota === 'buscar-places') return json({ success: true, places: [SO_MAPA(201), SO_MAPA(202), SO_MAPA(203)], hasMore: false, page: 1, total: 3 });
  if (rota === 'perfil') return json({ success: true, profile: { id: 1, userName: 'e', rank: 5, isAreaManager: true, isStaff: false, editableCountryIDs: [30], areas: [] } });
  if (rota === 'lista-paises') return json({ success: true, countries: [{ id: 30, name: 'Brazil' }] });
  if (rota === 'lista-estados') return json({ success: true, states: [] });
  return json({ success: true });
};
await ctx9k.route('**/api/*', rotaApi9k);
const abrirEm = async (contexto, nome) => {
  const pg = await contexto.newPage();
  pg.on('pageerror', (e) => errosJs.push({ secao: secaoAtual + ` [${nome}]`, txt: String(e.message) }));
  pg.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text()))
    violacoes.push({ secao: secaoAtual + ` [${nome}]`, txt: m.text() }); });
  await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  return pg;
};
// O modo dev é ligado no ARMAZENAMENTO por uma página que abriu com ele
// desligado: ela fecha sem gravar nada do diagnóstico.
const prepararDev = async (contexto, token) => {
  const prep = await abrirEm(contexto, 'preparo');
  await esperarNaPagina(prep, () => typeof API !== 'undefined', 20000, 100);
  await prep.evaluate((tk) => {
    API.setSession(tk);
    localStorage.setItem('waze_places_conta', JSON.stringify({ id: '1', s: marcaDaSessao(tk) }));
    localStorage.setItem('waze_places_preferences', JSON.stringify({ comoFuncionaVisto: true, undoEnabled: true, presenca: false }));
    localStorage.setItem('waze_places_devmode', JSON.stringify({ unlocked: true, active: true }));
  }, token);
  await prep.close({ runBeforeUnload: true });
};
const prontaComFab = (pg) => esperarNaPagina(pg, () => typeof AppState !== 'undefined' && AppState.authenticated
  && !!cardDaFrente() && AppState.queue.length === 3 && !document.getElementById('devFab').classList.contains('hidden'), 20000, 100);
// O toque no botão pelos ouvintes do PRÓPRIO botão (ponteiro que desce e sobe
// nele), como o dedo — e a gravação na base ESPERADA pelo fim, não por prazo.
const tocarFab = (pg, n) => pg.evaluate(async (n) => {
  const b = document.getElementById('devFabBtn');
  for (let i = 0; i < n; i++) {
    b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 50 + i, bubbles: true }));
    b.dispatchEvent(new PointerEvent('pointerup', { pointerId: 50 + i, bubbles: true }));
    await new Promise((r) => setTimeout(r, 5));
  }
  await diagGuardando;
  return dlogCapturasDoEditor().length;
}, n);
await prepararDev(ctx9k, 'tok-9k');
const A9k = await abrirEm(ctx9k, 'A');
const prontaA9k = await prontaComFab(A9k);
await dormir(50);   // as duas aberturas em milissegundos diferentes
const B9k = await abrirEm(ctx9k, 'B');
const prontaB9k = await prontaComFab(B9k);
const ab9k = { A: await A9k.evaluate(() => DIAG_ABERTURA), B: await B9k.evaluate(() => DIAG_ABERTURA) };
diz('PRÉ-CONDIÇÃO: as duas abas com a fila e o modo dev, a B aberta DEPOIS da A',
  prontaA9k.ok && prontaB9k.ok && ab9k.B.inicio > ab9k.A.inicio, JSON.stringify(ab9k));
const manuaisNaBase = (g, id) => ((g.abertas || []).find((a) => a.id === id) || {}).manuais;
// 1. A PODA (R7-4-03). A pré-condição prova que o instrumento lê a base: as 12 da B estão lá.
const nB9k = await tocarFab(B9k, 12);
const base1 = await guardado9c(A9k);
diz('PRÉ-CONDIÇÃO: a B registrou 12 telas, e as 12 estão na base', nB9k === 12 && manuaisNaBase(base1, ab9k.B.id) === 12,
  JSON.stringify({ nB9k, base1 }));
const nA9k = await tocarFab(A9k, 2);
const base2 = await guardado9c(A9k);
diz('a PODA vai pela hora da CAPTURA: as 2 telas da A (as mais novas) ficam na base, e da B saem as 2 mais velhas (R7-4-03)',
  nA9k === 2 && manuaisNaBase(base2, ab9k.A.id) === 2 && manuaisNaBase(base2, ab9k.B.id) === 10, JSON.stringify({ nA9k, base2 }));
// 2. O RELATÓRIO da A, de verdade, lido pela triagem (R7-4-04).
const dir9k = mkdtempSync(join(tmpdir(), 'smoke-9k-'));
let rel9k = null;
try {
  const [dl] = await Promise.all([A9k.waitForEvent('download', { timeout: 30000 }), A9k.evaluate(() => baixarDiagnostico())]);
  const arq = join(dir9k, 'diag.zip');
  await dl.saveAs(arq);
  const { dados: d } = lerDiagnostico(arq);
  const triagem = execFileSync(process.execPath, [join(ROOT, 'tools/diag-resumo.mjs'), arq], { encoding: 'utf8', timeout: 20000 });
  const b = (d.aberturasAnteriores || []).find((a) => a.id === ab9k.B.id) || {};
  rel9k = { atual: d.aberturaAtual && d.aberturaAtual.id, temB: !!b.id, simultanea: b.simultanea, abertaAgora: b.abertaAgora,
    simultaneas: d.resumo?.aberturasAnteriores?.simultaneas,
    triagem: /abertura [^\n]*\n  OUTRA ABA, aberta junto com a do relatório — seguia aberta na hora do relatório/.test(triagem),
    vazouToken: triagem.includes('tok-9k') };
} catch (e) {
  rel9k = { erro: String((e && e.message) || e).slice(0, 200) };
} finally {
  rmSync(dir9k, { recursive: true, force: true });
}
diz('o RELATÓRIO da A traz a B como OUTRA ABA aberta junto — e aberta agora —, e a triagem diz isso, não "abertura anterior" (R7-4-04)',
  rel9k?.atual === ab9k.A.id && rel9k?.temB === true && rel9k?.simultanea === true && rel9k?.abertaAgora === true
  && rel9k?.simultaneas >= 1 && rel9k?.triagem === true && rel9k?.vazouToken === false, JSON.stringify(rel9k));
// 3. A SENTINELA (R7-4-05): sem sinal (modo avião de verdade: abort + offline),
// a A rejeita o pedido da frente, que fica na fila de saída — e a B tem o MESMO
// card na frente.
aviao9k = true; await ctx9k.setOffline(true);
const frente9k = await A9k.evaluate(() => { window.__frente9k = AppState.currentPlace.venueID; return window.__frente9k; });
await A9k.evaluate(() => document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-reject').click());
const ficou9k = await esperarNaPagina(A9k, () => carregarFilaDeSaida().some((x) => x.venueID === window.__frente9k)
  && AppState.inFlightActions === 0 && !AppState.pendingAction, 15000, 100);
diz('PRÉ-CONDIÇÃO: a decisão da A ficou na fila de saída (sem sinal)', ficou9k.ok, frente9k);
const capturaDaB = (pg, encenarEntrada) => pg.evaluate((encenar) => {
  // A falha da ENTRADA, encenada: o mesmo pedido entrando DE NOVO na fila (outro objeto).
  if (encenar) AppState.queue.push(JSON.parse(JSON.stringify(AppState.currentPlace)));
  const b = document.getElementById('devFabBtn');
  b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 81, bubbles: true }));
  b.dispatchEvent(new PointerEvent('pointerup', { pointerId: 81, bubbles: true }));
  const m = dlogMomentos[dlogMomentos.length - 1];
  if (encenar) AppState.queue.pop();
  return { frente: AppState.currentPlace && AppState.currentPlace.venueID,
    alertas: (m.alertas || []).map((a) => a.chave), decididos: m.computado && m.computado.decididos };
}, encenarEntrada);
const cap9k = await capturaDaB(B9k, false);
diz('a captura da B NÃO acusa "pedido decidido voltou como card" — foi a OUTRA aba que decidiu, com o card já aqui (R7-4-05)',
  cap9k.frente === frente9k && !cap9k.alertas.includes('pedidoDecididoNaFila') && cap9k.decididos?.naFila === 0
  && cap9k.decididos?.porOutraAba === 1, JSON.stringify(cap9k));
const ctl9k = await capturaDaB(B9k, true);
diz('CONTROLE: o mesmo pedido ENTRANDO de novo na fila da B (a falha da entrada, encenada) segue acusado — a sentinela não ficou cega',
  ctl9k.alertas.includes('pedidoDecididoNaFila') && ctl9k.decididos?.naFila >= 1, JSON.stringify(ctl9k));
diz('e só o que ENTROU conta: o card que a outra aba decidiu segue de fora da conta (naFila 1, porOutraAba 1)',
  ctl9k.decididos?.naFila === 1 && ctl9k.decididos?.porOutraAba === 1, JSON.stringify(ctl9k));
// E o ✕ da B no mesmo pedido: o diário diz que foi a outra aba, não um caminho furado.
await B9k.evaluate(() => document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-reject').click());
await esperarNaPagina(B9k, () => !AppState.pendingAction && AppState.inFlightActions === 0
  && dfatoAnel.some((e) => e.k === 'saida.repetida'), 15000, 100);
const rep9k = await B9k.evaluate(() => dfatoAnel.filter((e) => e.k === 'saida.repetida').pop() || null);
diz('o ✕ da B no pedido que a A já decidiu: o "repetida" do diário diz que foi a OUTRA aba',
  !!rep9k && rep9k.outraAba === true, JSON.stringify(rep9k));
// Fecha ainda sem sinal: a volta da rede esvaziaria a fila de saída, e nada
// disso é desta seção. (A rota da API é reusada no 9l, com sinal.)
await ctx9k.close();
aviao9k = false;

secao('9l. O FAB DO MODO DEV E O BANNER DO TOPO: o FAB não fica em cima do "Restam"');
// R7-4-01. O FAB escolhe o canto pelo que recebe o dedo ali. Com um banner do
// topo na tela (o aviso da consequência do 1º ✕, a recusa automática), o
// `cima-dir` lia o banner — sem nada acionável nem `.nao-cobrir` — como LIVRE: o
// toque no FAB nesse meio o mandava pra cima do "Restam", e ele FICAVA lá depois
// de o banner sair (MEDIDO: 21% da tinta de "310" a 390×844, e o dedo ali caindo
// no FAB). Agora ele mede o que fica POR BAIXO dos avisos passageiros.
const ctx9l = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', serviceWorkers: 'block' });
await ctx9l.route('**/*-tiles/live/base/**', servirTile);
await ctx9l.route('**/api/*', rotaApi9k);
await prepararDev(ctx9l, 'tok-9l');
const F9l = await abrirEm(ctx9l, 'FAB');
const pronta9l = await prontaComFab(F9l);
// Quanto da TINTA do número do "Restam" o FAB cobre (`Range`, não a caixa), e
// quem recebe o dedo no meio da sobreposição. Lida com o botão PARADO: ele tem
// transição, e a reposição sai por quadro.
const tinta9l = async () => {
  let antes = null;
  for (let i = 0; i < 40; i++) {
    const agora = await F9l.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const r = document.getElementById('devFab').getBoundingClientRect(); ok(`${r.left},${r.top}`); }))));
    if (agora === antes) break;
    antes = agora;
  }
  return F9l.evaluate(() => {
    const fabEl = document.getElementById('devFab');
    const fab = fabEl.getBoundingClientRect();
    const el = document.getElementById('pendingCount');
    const rg = document.createRange(); rg.selectNodeContents(el);
    const r = rg.getBoundingClientRect();
    const x0 = Math.max(r.left, fab.left), x1 = Math.min(r.right, fab.right);
    const y0 = Math.max(r.top, fab.top), y1 = Math.min(r.bottom, fab.bottom);
    const area = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    const quem = area ? document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2) : null;
    return { canto: fabEl.dataset.canto, texto: el.textContent, cobre: Math.round(100 * area / (r.width * r.height)),
      noPonto: quem ? (quem.closest('#devFab') ? 'FAB' : (quem.id || quem.tagName)) : null,
      banners: document.querySelectorAll('#bannerContainer > *').length };
  });
};
// Sem animar a contagem: o número tem que estar INTEIRO na hora da medida.
await F9l.evaluate(() => { AppState.serverTotal = 310; AppState.hasMore = false; updatePendingCount(true); });
const inicio9l = await tinta9l();
diz('PRÉ-CONDIÇÃO: o "Restam" diz 310, e o FAB começa fora dele', pronta9l.ok && inicio9l.texto === '310' && inicio9l.cobre === 0,
  JSON.stringify(inicio9l));
// O banner do topo (o mesmo `showToast` do aviso da consequência), e o toque no FAB com ele na tela.
await F9l.evaluate(() => { window.__banner9l = showToast(t('consequencia.reject'), 'hint', 600000); });
const comBanner9l = await F9l.evaluate(() => document.querySelectorAll('#bannerContainer > *').length);
await tocarFab(F9l, 1);
const noBanner9l = await tinta9l();
await F9l.evaluate(() => window.__banner9l.dispensar());
await esperarNaPagina(F9l, () => document.querySelectorAll('#bannerContainer > *').length === 0, 5000, 50);
const depois9l = await tinta9l();
diz('PRÉ-CONDIÇÃO: o banner do topo estava na tela quando o FAB foi tocado', comBanner9l === 1 && noBanner9l.banners === 1,
  JSON.stringify({ comBanner9l, noBanner9l }));
diz('o toque no FAB com o banner na tela NÃO o manda pra cima do "Restam" — nem com o banner, nem depois de ele sair (R7-4-01)',
  noBanner9l.cobre === 0 && depois9l.cobre === 0 && depois9l.noPonto !== 'FAB' && depois9l.banners === 0, JSON.stringify({ noBanner9l, depois9l }));
// CONTROLE: o instrumento ENXERGA a sobreposição — com o FAB posto no `cima-dir`,
// ele come a tinta do "Restam" nesta tela, e o dedo ali cai no FAB.
const forcado9l = await F9l.evaluate(() => {
  const fab = document.getElementById('devFab');
  const r = fab.getBoundingClientRect();
  const { x, y } = devFabCoords('cima-dir', r.width || 44, r.height || 44);
  fab.style.left = x + 'px'; fab.style.top = y + 'px'; fab.dataset.canto = 'cima-dir(forçado)';
  return true;
});
const cima9l = await tinta9l();
diz('CONTROLE: com o FAB posto à força no cima-dir, a medida acusa a tinta coberta e o dedo no FAB — ela enxerga o defeito',
  forcado9l && cima9l.cobre > 0 && cima9l.noPonto === 'FAB', JSON.stringify(cima9l));
await ctx9l.close();

secao('9m. O RELATÓRIO: a aba mais VELHA que fechou antes dele, e o relatório feito DENTRO do treino');
// Auditoria da rodada 8 (R8-4-07, R8-4-06), as duas no MESMO relatório.
//  · A aba B abre ANTES da A, registra telas, vai pro fundo (grava na base) e é
//    FECHADA depois de a A abrir. O fechar aborta a gravação da base (MEDIDO no
//    r2 `bAntes` da auditoria: em 3 de 4 rodadas a última gravação de B ficou a
//    de ANTES de a A abrir); aqui a gravação do fechar é DESLIGADA na B, pra a
//    seção não depender da sorte (a amplificação declarada). A trava de B já
//    estava solta na hora do relatório: a A a dava como "abertura anterior". A
//    prova que faltava é a trava SEGURA quando a A abriu.
//  · O relatório da A é baixado com o TREINO aberto: o `appState` tem os
//    EXEMPLOS (o CONTROLE do instrumento), e o arquivo não dizia que o treino
//    estava aberto nem levava a fila real que ele guarda.
const ctx9m = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR',
  serviceWorkers: 'block', acceptDownloads: true });
await ctx9m.route('**/*-tiles/live/base/**', servirTile);
await ctx9m.route('**/api/*', rotaApi9k);
await prepararDev(ctx9m, 'tok-9m');
const B9m = await abrirEm(ctx9m, 'B (a mais velha)');
const prontaB9m = await prontaComFab(B9m);
const nB9m = await tocarFab(B9m, 2);
// B vai pro fundo (a pessoa abre outra aba): grava, e segura a trava dela.
const idB9m = await B9m.evaluate(async () => { await diagGuardarAbertura('oculta'); return DIAG_ABERTURA.id; });
await dormir(50);
const A9m = await abrirEm(ctx9m, 'A');
const prontaA9m = await prontaComFab(A9m);
await esperarNaPagina(A9m, () => dfatoAnel.some((e) => e.k === 'diag.aberturas' || e.k === 'diag.carregarFalhou'), 20000, 100);
const travaDeB = (pg, id) => pg.evaluate(async (i) => (await navigator.locks.query()).held.some((l) => l.name === '__diagAbertura:' + i), id);
const vivaComA9m = await travaDeB(A9m, idB9m);
await B9m.evaluate(() => { window.diagGuardarAbertura = () => Promise.resolve(false); });
await B9m.close({ runBeforeUnload: true });
let soltou9m = false;
for (let i = 0; i < 50 && !soltou9m; i++) { soltou9m = !(await travaDeB(A9m, idB9m)); if (!soltou9m) await dormir(100); }
const inicioA9m = await A9m.evaluate(() => DIAG_ABERTURA.inicio);
// O TREINO, aberto como a Ajuda o abre, e uma captura nele.
await A9m.evaluate(() => Treino.entrar());
const treino9m = await esperarNaPagina(A9m, () => Treino.ativo === true
  && !document.getElementById('treinoBanner').classList.contains('hidden'), 5000, 50);
await tocarFab(A9m, 1);
const dir9m = mkdtempSync(join(tmpdir(), 'smoke-9m-'));
let rel9m = null;
try {
  const [dl] = await Promise.all([A9m.waitForEvent('download', { timeout: 30000 }), A9m.evaluate(() => baixarDiagnostico())]);
  const arq = join(dir9m, 'diag.zip');
  await dl.saveAs(arq);
  const { dados: d } = lerDiagnostico(arq);
  const triagem = execFileSync(process.execPath, [join(ROOT, 'tools/diag-resumo.mjs'), arq], { encoding: 'utf8', timeout: 20000 });
  const b = (d.aberturasAnteriores || []).find((a) => a.id === idB9m) || {};
  const ultima = (d.momentos || [])[(d.momentos || []).length - 1] || {};
  rel9m = { temB: !!b.id, capturasB: (b.momentos || []).length, simultanea: b.simultanea, abertaAgora: b.abertaAgora,
    gravouAntesDeA: Number.isFinite(b.salvoEm) && b.salvoEm < inicioA9m,
    triagemB: new RegExp('abertura ' + idB9m + ' · [^\\n]*\\n  OUTRA ABA, aberta junto com a do relatório — já tinha fechado na hora do relatório').test(triagem),
    treinoTela: d.resumo?.telaAgora?.treino, treinoCaptura: ultima.treino,
    filaReal: (d.treino?.fila || []).map((p) => p && p.updateRequestID).sort(),
    soExemplosNoAppState: (d.appState?.queue || []).length > 0 && (d.appState.queue || []).every((p) => p && p._treino === true),
    triagemTreino: triagem.includes('ATENÇÃO: relatório gerado DENTRO do treino')
      && /fila real guardada pelo treino: 3 pedidos/.test(triagem) && /DENTRO DO TREINO \(\d+ exemplos na fila\)/.test(triagem),
    vazouToken: triagem.includes('tok-9m') };
} catch (e) {
  rel9m = { erro: String((e && e.message) || e).slice(0, 200) };
} finally {
  rmSync(dir9m, { recursive: true, force: true });
}
diz('PRÉ-CONDIÇÃO: a B (a mais velha) registrou 2 telas e gravou ANTES de a A abrir; a trava dela estava segura com a A aberta, e soltou ao fechar',
  prontaB9m.ok && prontaA9m.ok && nB9m === 2 && vivaComA9m === true && soltou9m && rel9m?.gravouAntesDeA === true && rel9m?.capturasB === 2,
  JSON.stringify({ prontaB: prontaB9m.ok, prontaA: prontaA9m.ok, nB9m, vivaComA9m, soltou9m, rel9m }));
diz('a aba mais velha, fechada ANTES do relatório e sem gravar depois de a A abrir, vem como OUTRA ABA (já fechada), e a triagem diz isso (R8-4-07)',
  rel9m?.temB === true && rel9m?.simultanea === true && rel9m?.abertaAgora === false && rel9m?.triagemB === true,
  JSON.stringify(rel9m));
diz('PRÉ-CONDIÇÃO: o treino estava aberto, e o `appState` do arquivo tem só os EXEMPLOS (a fila real não está nele)',
  treino9m.ok && rel9m?.soExemplosNoAppState === true, JSON.stringify({ treino: treino9m.ok, rel9m }));
diz('o relatório feito DENTRO do treino diz isso (na tela e na captura) e leva a fila REAL que o treino guarda; a triagem avisa e conta, sem o token (R8-4-06)',
  rel9m?.treinoTela?.ativo === true && rel9m?.treinoCaptura?.ativo === true
  && JSON.stringify(rel9m?.filaReal) === JSON.stringify(['u201', 'u202', 'u203'])
  && rel9m?.triagemTreino === true && rel9m?.vazouToken === false, JSON.stringify(rel9m));
await ctx9m.close();

secao('9n. O RELATÓRIO DEPOIS DA TROCA DE CONTA, AS TELAS QUE A OUTRA ABA ENTREGOU, E O FAB × O "N ESPERANDO ENVIO"');
// Auditoria da rodada 9, três achados do diagnóstico que só o navegador mede.
//  · (R9-1-01 = R9-4-04) A troca de conta limpa a lista de recursos, e o código
//    da página (carregado ANTES da limpeza) saía junto: o relatório de quem entrou
//    conferia 2 de 11 arquivos, e o `diag-tela` remontava sem o CSS. A lista do
//    código passou a vir também do DOCUMENTO.
//  · (R9-4-10) As telas da aba B que foram no relatório baixado na A voltavam pra
//    base quando B ia pro fundo de novo, e saíam de novo no próximo relatório; B
//    seguia contando "2 não baixados". O download avisa as outras abas.
//  · (R9-4-05) No computador, o FAB pousava no `cima-dir` e cobria 100% do
//    "N esperando envio": o número não era `.nao-cobrir`, a grade do FAB não o
//    tocava, e nada reavaliava o canto quando ele aparecia.
const ctx9n = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR',
  serviceWorkers: 'block', acceptDownloads: true });
await ctx9n.route('**/*-tiles/live/base/**', servirTile);
await ctx9n.route('**/api/*', rotaApi9k);
// O aparelho guarda os dados de OUTRA conta ('9'), com a marca da sessão desta:
// o perfil (o id 1 da rota) chega e é a troca de conta na abertura.
const prep9n = await abrirEm(ctx9n, 'preparo');
await esperarNaPagina(prep9n, () => typeof API !== 'undefined', 20000, 100);
await prep9n.evaluate(() => {
  API.setSession('tok-9n');
  localStorage.setItem('waze_places_conta', JSON.stringify({ id: '9', s: marcaDaSessao('tok-9n') }));
  localStorage.setItem('waze_places_preferences', JSON.stringify({ comoFuncionaVisto: true, undoEnabled: true, presenca: false }));
  localStorage.setItem('waze_places_devmode', JSON.stringify({ unlocked: true, active: true }));
});
await prep9n.close({ runBeforeUnload: true });
const A9n = await abrirEm(ctx9n, 'A');
const prontaA9n = await prontaComFab(A9n);
const trocou9n = await esperarNaPagina(A9n, () => dfatoAnel.some((e) => e.k === 'conta.trocou'), 10000, 100);
const pre9n = await A9n.evaluate(() => ({ dev: !!(AppState.devMode && AppState.devMode.active),
  codigoNaLista: diagRecursosDaSessao().filter((r) => /\/js\/min\/|\/css\//.test(r.name)).length }));
diz('PRÉ-CONDIÇÃO: a troca de conta aconteceu, o modo dev segue ligado, e a lista de recursos da sessão ficou SEM o código da página',
  prontaA9n.ok && trocou9n.ok && pre9n.dev && pre9n.codigoNaLista === 0, JSON.stringify({ pronta: prontaA9n.ok, trocou: trocou9n.ok, pre9n }));
const dir9n = mkdtempSync(join(tmpdir(), 'smoke-9n-'));
const baixar9n = async (pg, nome) => {
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 30000 }), pg.evaluate(() => baixarDiagnostico())]);
  const arq = join(dir9n, nome + '.zip');
  await dl.saveAs(arq);
  await pg.evaluate(() => diagGuardando);
  return lerDiagnostico(arq).dados;
};
let cod9n = null;
try {
  const d = await baixar9n(A9n, 'troca');
  const caminhos = Object.keys(d.codigo || {}).map((u) => u.replace(/^https?:\/\/[^/]+/, ''));
  const css = Object.entries(d.codigo || {}).find(([u]) => /\/css\/app\.css$/.test(u));
  cod9n = { caminhos, cssComCorpo: !!(css && typeof css[1].corpo === 'string' && css[1].corpo.length > 1000),
    comparados: Object.keys(d.cacheVsRede || {}).filter((u) => /\/js\/min\/app\.js$|\/css\/app\.css$/.test(u)).length };
} catch (e) { cod9n = { erro: String((e && e.message) || e).slice(0, 200) }; }
diz('depois da TROCA DE CONTA, o relatório ainda leva o código da página — o app.js e o CSS (com o corpo, de que o diag-tela remonta), conferidos com o servidor (R9-1-01)',
  !!cod9n?.caminhos && cod9n.caminhos.includes('/js/min/app.js') && cod9n.caminhos.includes('/css/app.css')
  && cod9n.cssComCorpo === true && cod9n.comparados === 2, JSON.stringify(cod9n));
// (R9-4-10) A aba B, aberta junto, registra 2 telas e vai pro fundo (a gravação de
// ir pro fundo, chamada direto: a amplificação declarada das outras seções).
const B9n = await abrirEm(ctx9n, 'B');
const prontaB9n = await prontaComFab(B9n);
const idB9n = await B9n.evaluate(() => DIAG_ABERTURA.id);
const nB9n = await tocarFab(B9n, 2);
await B9n.evaluate(() => diagGuardarAbertura('oculta'));
const telasDeB = (d) => (d.aberturasAnteriores || []).filter((a) => a.id === idB9n)
  .flatMap((a) => a.momentos || []).filter((m) => m.motivo === 'manual').length;
let ab9n = null;
try {
  const d1 = await baixar9n(A9n, 'abas-1');
  // O aviso do navegador chega a B — pelo FIM (a conta zerar), não por prazo.
  const avisada = await esperarNaPagina(B9n, () => dlogNaoBaixados() === 0, 5000, 50);
  const naoBaixadosB = await B9n.evaluate(() => dlogNaoBaixados());
  // B registra MAIS UMA tela depois do download, e vai pro fundo de novo.
  await tocarFab(B9n, 1);
  const novaNaoBaixada = await B9n.evaluate(() => !dlogJaBaixados.has(dlogMomentos[dlogMomentos.length - 1]));
  await B9n.evaluate(() => diagGuardarAbertura('oculta'));
  const base9n = await guardado9c(A9n);
  const d2 = await baixar9n(A9n, 'abas-2');
  ab9n = { noPrimeiro: telasDeB(d1), avisada: avisada.ok, naoBaixadosB, novaNaoBaixada,
    naBase: ((base9n.abertas || []).find((a) => a.id === idB9n) || {}).manuais, noSegundo: telasDeB(d2) };
} catch (e) { ab9n = { erro: String((e && e.message) || e).slice(0, 200) }; }
diz('PRÉ-CONDIÇÃO: B registrou 2 telas, e o relatório da A as levou',
  prontaB9n.ok && nB9n === 2 && ab9n?.noPrimeiro === 2, JSON.stringify({ pronta: prontaB9n.ok, nB9n, ab9n }));
diz('as telas de B que foram no relatório da A contam como entregues em B — o aviso do desligar não as conta (R9-4-10)',
  ab9n?.avisada === true && ab9n?.naoBaixadosB === 0, JSON.stringify(ab9n));
// (Lida no PRÓPRIO momento, e não pela contagem: o controle vale com e sem o
// conserto — o que ele pega é a marcação larga demais, que daria a tela nova por
// entregue.)
diz('CONTROLE: a tela que B registrou DEPOIS do download segue não baixada', ab9n?.novaNaoBaixada === true, JSON.stringify(ab9n));
diz('B, indo pro fundo de novo, guarda SÓ a tela nova — e o 2º relatório da A não leva de novo as que já foram (R9-4-10)',
  ab9n?.naBase === 1 && ab9n?.noSegundo === 1, JSON.stringify(ab9n));
rmSync(dir9n, { recursive: true, force: true });
await ctx9n.close();
// (R9-4-05) O computador: 1280×800, e o modo avião de verdade (abort + offline)
// com um ✕ — a decisão fica esperando envio, e o indicador aparece no canto do FAB.
const ctx9nL = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'pt-BR', serviceWorkers: 'block' });
let aviao9n = false;
await ctx9nL.route('**/*-tiles/live/base/**', (r) => (aviao9n ? r.abort('internetdisconnected') : servirTile(r)));
await ctx9nL.route('**/api/*', (r) => (aviao9n ? r.abort('internetdisconnected') : rotaApi9k(r)));
// O aviso da consequência do 1º ✕ (um banner do topo) já visto: ele é passageiro
// pro FAB, mas por cima do indicador a medida do dedo mediria o banner.
const prepL9n = await abrirEm(ctx9nL, 'preparo');
await esperarNaPagina(prepL9n, () => typeof API !== 'undefined', 20000, 100);
await prepL9n.evaluate(() => {
  API.setSession('tok-9n-largo');
  localStorage.setItem('waze_places_conta', JSON.stringify({ id: '1', s: marcaDaSessao('tok-9n-largo') }));
  localStorage.setItem('waze_places_preferences', JSON.stringify({ comoFuncionaVisto: true, undoEnabled: true, presenca: false,
    consequenciaVista: { reject: true, read: true } }));
  localStorage.setItem('waze_places_devmode', JSON.stringify({ unlocked: true, active: true }));
});
await prepL9n.close({ runBeforeUnload: true });
const L9n = await abrirEm(ctx9nL, 'computador');
const prontaL9n = await prontaComFab(L9n);
// O FAB PARADO (ele tem transição, e a reposição sai por quadro), e quanto da
// caixa do indicador ele cobre, e quem recebe o dedo no meio dela.
const fab9n = async () => {
  let antes = null;
  for (let i = 0; i < 40; i++) {
    const agora = await L9n.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const r = document.getElementById('devFab').getBoundingClientRect(); ok(`${r.left},${r.top}`); }))));
    if (agora === antes) break;
    antes = agora;
  }
  return L9n.evaluate(() => {
    const fabEl = document.getElementById('devFab');
    const fab = fabEl.getBoundingClientRect();
    const el = document.getElementById('inFlightIndicator');
    if (!el) return { canto: fabEl.dataset.canto, indicador: false };
    const r = el.getBoundingClientRect();
    const x0 = Math.max(r.left, fab.left), x1 = Math.min(r.right, fab.right);
    const y0 = Math.max(r.top, fab.top), y1 = Math.min(r.bottom, fab.bottom);
    const area = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    const quem = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { canto: fabEl.dataset.canto, indicador: true, titulo: el.title, cobre: Math.round(100 * area / (r.width * r.height)),
      noCentro: quem ? (quem.closest('#devFab') ? 'FAB' : quem.closest('#inFlightIndicator') ? 'indicador' : (quem.id || quem.tagName)) : null };
  });
};
const antes9n = await fab9n();
diz('PRÉ-CONDIÇÃO: no computador, sem o indicador, o FAB fica no canto preferido (cima-dir)',
  prontaL9n.ok && antes9n.canto === 'cima-dir' && antes9n.indicador === false, JSON.stringify(antes9n));
aviao9n = true; await ctx9nL.setOffline(true);
await L9n.evaluate(() => document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-reject').click());
const esperando9n = await esperarNaPagina(L9n, () => carregarFilaDeSaida().length === 1 && AppState.inFlightActions === 0
  && !AppState.pendingAction && !!document.getElementById('inFlightIndicator'), 15000, 100);
const com9n = await fab9n();
diz('PRÉ-CONDIÇÃO: sem sinal, o ✕ ficou esperando envio, e o indicador está na tela', esperando9n.ok && com9n.indicador === true,
  JSON.stringify(com9n));
diz('no computador, o FAB NÃO cobre o "N esperando envio" — reavaliado quando o número apareceu (R9-4-05)',
  com9n.cobre === 0 && com9n.noCentro === 'indicador' && com9n.canto !== 'cima-dir', JSON.stringify(com9n));
// (R11-4-04) O que o DIAGNÓSTICO vê disso: o indicador na geometria, com a marca
// de número a não cobrir, e a sentinela `indicadorEscondido` quieta. Pelo
// computado + sentinelas DIRETO (sem a captura, que reposiciona o FAB ao contar).
const diag9n = () => L9n.evaluate(() => {
  const c = diagComputado();
  const g = (c.geometria || []).find((x) => x.sel === '#inFlightIndicator') || null;
  return { ind: g && { naoCobrir: g.naoCobrir, noCentro: g.noCentro, sobFab: g.sobFab },
           alertas: diagSentinelas(c).filter((a) => a.chave === 'indicadorEscondido') };
});
const diagCom9n = await diag9n();
diz('o diagnóstico MEDE o "N esperando envio" (número a não cobrir, à vista) e não acusa nada (R11-4-04)',
  !!diagCom9n.ind && diagCom9n.ind.naoCobrir === true && diagCom9n.ind.noCentro === 'ele mesmo' && diagCom9n.alertas.length === 0,
  JSON.stringify(diagCom9n));
// CONTROLE: o instrumento ENXERGA a sobreposição — com o FAB posto à força no
// `cima-dir`, ele cobre o número, e o dedo no meio dele cai no FAB.
await L9n.evaluate(() => {
  const fab = document.getElementById('devFab');
  const r = fab.getBoundingClientRect();
  const { x, y } = devFabCoords('cima-dir', r.width || 44, r.height || 44);
  fab.style.left = x + 'px'; fab.style.top = y + 'px'; fab.dataset.canto = 'cima-dir(forçado)';
});
const forcado9n = await fab9n();
diz('CONTROLE: com o FAB posto à força no cima-dir, a medida acusa o número coberto e o dedo no FAB',
  forcado9n.cobre > 0 && forcado9n.noCentro === 'FAB', JSON.stringify(forcado9n));
// E o diagnóstico ACUSA a mesma cobertura — o defeito do R9-4-05/R11-4-03 que
// nenhum relatório mostrava (R11-4-04) —, dizendo que é o FAB. O FAB que o
// EDITOR pôs ali (`devFabFixado`) é escolha dele, e cala.
const diagForcado9n = await diag9n();
diz('com o FAB por cima do "N esperando envio", o diagnóstico acusa `indicadorEscondido`, dizendo que é o FAB (R11-4-04)',
  diagForcado9n.alertas.length === 1 && diagForcado9n.alertas[0].fab === true && diagForcado9n.ind && diagForcado9n.ind.sobFab === true,
  JSON.stringify(diagForcado9n));
const diagFixado9n = await L9n.evaluate(() => { devFabFixado = true;
  const n = diagSentinelas(diagComputado()).filter((a) => a.chave === 'indicadorEscondido').length;
  devFabFixado = false; return n; });
diz('o mesmo FAB, arrastado pelo editor pra lá, não vira alerta', diagFixado9n === 0, JSON.stringify({ diagFixado9n }));
// A rede volta: a fila de saída esvazia, o indicador SOME — e o FAB volta ao canto preferido.
aviao9n = false; await ctx9nL.setOffline(false);
const saiu9n = await esperarNaPagina(L9n, () => carregarFilaDeSaida().length === 0 && !document.getElementById('inFlightIndicator'), 20000, 100);
const depois9n = await fab9n();
diz('com a rede de volta, o indicador some e o FAB volta ao cima-dir — reavaliado quando o número sumiu',
  saiu9n.ok && depois9n.indicador === false && depois9n.canto === 'cima-dir', JSON.stringify(depois9n));
// (R10-4-05) COM rede, o indicador nasce em toda decisão ("1 enviando", a ida ao
// Waze) — e a decisão que sai mora na fila de saída enquanto voa (anotada antes
// do envio). Com o número a não cobrir em todo estado, o FAB atravessava a tela
// duas vezes a cada ✕ (MEDIDO, n15 da auditoria da rodada 10: 6 trocas de canto
// em 3 decisões). Aqui, um ✕ com a resposta levando 300 ms (cada ida é uma
// tarefa à parte, como na rede de verdade) e sem a janela do Desfazer, com um
// card ainda na fila depois dele (o fim da fila muda a tela, e o FAB mudaria de
// canto por outro motivo); as trocas de canto contadas pela MUTAÇÃO do atributo,
// com o valor de antes de cada uma.
await L9n.route('**/api/validar-place', async (r) => { await dormir(300); return rotaApi9k(r); });
await L9n.evaluate(() => {
  AppState.preferences.undoEnabled = false;
  const fab = document.getElementById('devFab');
  window.__cantos9n = [];
  window.__fab9nObs = new MutationObserver((ms) => { for (const m of ms) window.__cantos9n.push([m.oldValue, fab.dataset.canto]); });
  window.__fab9nObs.observe(fab, { attributes: true, attributeFilter: ['data-canto'], attributeOldValue: true });
  window.__indic9n = 0;
  window.__indic9nObs = new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.id === 'inFlightIndicator') window.__indic9n++; });
  window.__indic9nObs.observe(document.body, { childList: true });
});
const decidiu9n = [];
for (let i = 0; i < 1; i++) {
  // (O placar de antes fica NA PÁGINA: a função da espera vai serializada, e uma
  // variável do Node chegaria lá `undefined` — gotcha #28.)
  await L9n.evaluate(() => { window.__antes9n = AppState.stats.rejected;
    document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-reject').click(); });
  decidiu9n.push((await esperarNaPagina(L9n, () => AppState.stats.rejected === window.__antes9n + 1 && AppState.inFlightActions === 0
    && carregarFilaDeSaida().length === 0 && !document.getElementById('inFlightIndicator'), 15000, 50)).ok);
}
const trocas9n = await L9n.evaluate(() => {
  const trocas = window.__cantos9n.filter(([de, para]) => de !== para).length;
  // CONTROLE do instrumento: uma troca forçada é contada.
  const fab = document.getElementById('devFab');
  const era = fab.dataset.canto;
  fab.dataset.canto = 'forcado';
  return new Promise((ok) => setTimeout(() => {
    const contou = window.__cantos9n.filter(([de, para]) => de !== para).length - trocas;
    fab.dataset.canto = era;
    window.__fab9nObs.disconnect(); window.__indic9nObs.disconnect();
    ok({ trocas, contou, nasceu: window.__indic9n, canto: era, naFila: AppState.queue.length });
  }, 0));
});
diz('PRÉ-CONDIÇÃO: o ✕ saiu com rede — o "enviando" nasceu, a fila de saída ficou vazia e sobrou um card',
  decidiu9n.every(Boolean) && trocas9n.nasceu === 1 && trocas9n.naFila >= 1, JSON.stringify({ decidiu9n, trocas9n }));
diz('CONTROLE: o contador enxerga uma troca de canto (a forçada)', trocas9n.contou === 1, JSON.stringify(trocas9n));
diz('com rede, o FAB NÃO muda de canto a cada decisão — o "1 enviando" não é número a não cobrir (R10-4-05)',
  trocas9n.trocas === 0 && trocas9n.canto === 'cima-dir', JSON.stringify(trocas9n));
await ctx9nL.close();
// (R10-4-02) O iPhone com o app INSTALADO: a margem de segurança de cima (47 px)
// entra no cabeçalho, e o "N esperando envio" a 80 px fixos ficava DEBAIXO dele
// (MEDIDO, n21 da auditoria: o dedo no meio dele caía no ⓘ). A margem vem do CDP
// do Chromium e entra ANTES da carga, como no aparelho, que já abre com ela
// (posta depois, o observador do cabeçalho, que olha a caixa de CONTEÚDO, não vê
// o padding mudar). CONTROLE: sem margem, o indicador fica nos 80 px de sempre.
const margem9n = async (topo) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', serviceWorkers: 'block' });
  let aviao = false;
  await ctx.route('**/*-tiles/live/base/**', (r) => (aviao ? r.abort('internetdisconnected') : servirTile(r)));
  await ctx.route('**/api/*', (r) => (aviao ? r.abort('internetdisconnected') : rotaApi9k(r)));
  const prep = await abrirEm(ctx, 'margem ' + topo + ', preparo');
  await esperarNaPagina(prep, () => typeof API !== 'undefined', 20000, 100);
  await prep.evaluate(() => {
    API.setSession('tok-9n-margem');
    localStorage.setItem('waze_places_conta', JSON.stringify({ id: '1', s: marcaDaSessao('tok-9n-margem') }));
    localStorage.setItem('waze_places_preferences', JSON.stringify({ comoFuncionaVisto: true, presenca: false,
      consequenciaVista: { reject: true, read: true } }));
  });
  const cdp = await ctx.newCDPSession(prep);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: topo, topMax: topo, bottom: 0, bottomMax: 0,
    left: 0, leftMax: 0, right: 0, rightMax: 0 } });
  await prep.reload({ waitUntil: 'domcontentloaded' });
  const pronta = await esperarNaPagina(prep, () => typeof AppState !== 'undefined' && AppState.authenticated && !!cardDaFrente(), 20000, 100);
  aviao = true; await ctx.setOffline(true);
  await prep.evaluate(() => document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-reject').click());
  const esperando = await esperarNaPagina(prep, () => carregarFilaDeSaida().length === 1 && !AppState.pendingAction
    && AppState.inFlightActions === 0 && !!document.getElementById('inFlightIndicator'), 15000, 100);
  const m = await prep.evaluate(() => {
    const h = document.querySelector('header').getBoundingClientRect();
    const r = document.getElementById('inFlightIndicator').getBoundingClientRect();
    const quem = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { cabecalho: Math.round(h.bottom), topo: Math.round(r.top),
      noCentro: quem ? (quem.closest('#inFlightIndicator') ? 'indicador' : quem.closest('header') ? 'cabeçalho' : (quem.id || quem.tagName)) : null };
  });
  await ctx.close();
  return { pronta: pronta.ok, esperando: esperando.ok, ...m };
};
const semMargem9n = await margem9n(0);
diz('CONTROLE: sem a margem de cima, o "N esperando envio" fica nos 80 px de sempre, à vista',
  semMargem9n.pronta && semMargem9n.esperando && semMargem9n.topo === 80 && semMargem9n.noCentro === 'indicador', JSON.stringify(semMargem9n));
const comMargem9n = await margem9n(47);
diz('PRÉ-CONDIÇÃO: com a margem do iPhone instalado, o cabeçalho cresceu dela', comMargem9n.pronta && comMargem9n.esperando
  && comMargem9n.cabecalho >= 110, JSON.stringify(comMargem9n));
diz('com a margem do iPhone instalado, o "N esperando envio" fica ABAIXO do cabeçalho, à vista (R10-4-02)',
  comMargem9n.topo >= comMargem9n.cabecalho && comMargem9n.noCentro === 'indicador', JSON.stringify(comMargem9n));
// (R12-4-04) O "N esperando envio" que nasce NO MEIO de um arraste de card: a
// decisão anterior, presa no ar, falha por rede com o dedo arrastando o card
// seguinte. O FAB ESPERA o gesto acabar pra trocar de canto (a decisão do
// R10-4-05) e fica por cima do número até o dedo soltar — e a captura automática
// do MESMO arraste rodava a sentinela nesse instante e acusava
// `indicadorEscondido`, num estado que o app não garante (MEDIDO, n4 da
// auditoria). No computador (1280×800), como lá. CONTROLE: o FAB está MESMO por
// cima do número durante o gesto (o caso foi encenado), e sai quando o dedo solta.
const arraste9n = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'pt-BR', serviceWorkers: 'block' });
  let aviao = false;
  let prender = false;
  const presos = [];
  await ctx.route('**/*-tiles/live/base/**', (r) => (aviao ? r.abort('internetdisconnected') : servirTile(r)));
  await ctx.route('**/api/*', (r) => {
    if (aviao) return r.abort('internetdisconnected');
    if (prender && /\/api\/validar-place$/.test(r.request().url())) { presos.push(r); return; }
    return rotaApi9k(r);
  });
  const pg = await abrirEm(ctx, 'arraste');
  await esperarNaPagina(pg, () => typeof API !== 'undefined', 20000, 100);
  await pg.evaluate(() => {
    API.setSession('tok-9n-arraste');
    localStorage.setItem('waze_places_conta', JSON.stringify({ id: '1', s: marcaDaSessao('tok-9n-arraste') }));
    localStorage.setItem('waze_places_preferences', JSON.stringify({ comoFuncionaVisto: true, presenca: false, undoEnabled: false,
      consequenciaVista: { reject: true, read: true } }));
    localStorage.setItem('waze_places_devmode', JSON.stringify({ unlocked: true, active: true }));
  });
  await pg.reload({ waitUntil: 'domcontentloaded' });
  const pronta = await prontaComFab(pg);
  await dormir(800);   // o FAB assenta no canto (ele se reposiciona quando o card assenta)
  prender = true;
  await pg.evaluate(() => document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-reject').click());
  const enviando = await esperarNaPagina(pg, () => AppState.inFlightActions === 1 && !!document.getElementById('inFlightIndicator')
    && !window.isSwipeAnimating(), 10000, 50);
  await dormir(300);
  const c = await pg.evaluate(() => { const r = cardDaFrente().getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.75 }; });
  await pg.mouse.move(c.x, c.y); await pg.mouse.down();
  for (let k = 1; k <= 5; k++) { await pg.mouse.move(c.x + 20 * k, c.y + 1); await dormir(20); }
  // A decisão presa falha por REDE no meio do arraste: vira "esperando" (número a não cobrir).
  aviao = true; await ctx.setOffline(true);
  for (const r of presos.splice(0)) await r.abort('internetdisconnected').catch(() => {});
  const esperando = await esperarNaPagina(pg, () => carregarFilaDeSaida().length === 1 && AppState.inFlightActions === 0
    && !!document.getElementById('inFlightIndicator')?.classList.contains('nao-cobrir'), 10000, 50);
  const noGesto = await pg.evaluate(() => {
    const r = document.getElementById('inFlightIndicator').getBoundingClientRect();
    const quem = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    // A contagem fica NA PÁGINA: a espera abaixo vai serializada (gotcha #28).
    window.__capturas9n = dlogMomentos.length;
    return { espera: fabEsperaOGesto, fabPorCima: !!(quem && quem.closest('#devFab')), capturas: dlogMomentos.length };
  });
  // Passa do limiar (25% da largura): a captura automática do arraste.
  const limiar = 1280 * 0.25 + 30;
  for (let k = 1; k <= 8; k++) { await pg.mouse.move(c.x + 100 + (limiar - 100) * k / 8, c.y + 2); await dormir(20); }
  const capturou = await esperarNaPagina(pg, () => dlogMomentos.length > window.__capturas9n, 5000, 50);
  const captura = await pg.evaluate(() => {
    const m = dlogMomentos[dlogMomentos.length - 1];
    return m ? { motivo: m.motivo, alertas: (m.alertas || []).map((a) => a.chave) } : null;
  });
  // O dedo volta ao meio e solta, sem decidir: o fim do gesto escolhe o canto.
  await pg.mouse.move(c.x, c.y); await pg.mouse.up();
  await esperarNaPagina(pg, () => !fabEsperaOGesto && !window.isSwipeAnimating(), 5000, 50);
  await dormir(300);
  const depois = await pg.evaluate(() => {
    const r = document.getElementById('inFlightIndicator').getBoundingClientRect();
    const quem = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { fabPorCima: !!(quem && quem.closest('#devFab')),
      alertas: (diagNoInstante().alertas || []).map((a) => a.chave).filter((k) => k === 'indicadorEscondido') };
  });
  await ctx.close();
  return { pronta: pronta.ok, enviando: enviando.ok, esperando: esperando.ok, noGesto, capturou: capturou.ok, captura, depois };
};
const arr9n = await arraste9n();
diz('PRÉ-CONDIÇÃO: o "N esperando envio" nasceu no MEIO do arraste, com o FAB esperando o gesto e por cima do número',
  arr9n.pronta && arr9n.enviando && arr9n.esperando && arr9n.noGesto.espera === true && arr9n.noGesto.fabPorCima === true,
  JSON.stringify(arr9n));
diz('a captura automática do arraste não acusa `indicadorEscondido` pelo FAB que espera o gesto (R12-4-04)',
  arr9n.capturou && arr9n.captura?.motivo === 'auto:arraste' && Array.isArray(arr9n.captura.alertas)
  && !arr9n.captura.alertas.includes('indicadorEscondido'), JSON.stringify(arr9n.captura));
diz('CONTROLE: o dedo solta, o FAB sai de cima do número — e o diagnóstico segue sem acusar nada',
  arr9n.depois.fabPorCima === false && arr9n.depois.alertas.length === 0, JSON.stringify(arr9n.depois));

secao('10. NADA DE ERRO, NADA DE CSP');
diz('nenhum erro de JS em todo o percurso', errosJs.length === 0, JSON.stringify(errosJs.slice(0, 3)));
diz('nenhuma violação de CSP', violacoes.length === 0, JSON.stringify(violacoes.slice(0, 3)));

await browser.close();
servidor.kill();
if (falhas) {
  console.log(`\n✗ smoke do offline: ${falhas} falha(s)`);
  process.exit(1);
}
console.log(`\n✓ smoke do offline: ${secoesRodadas} seções — o MAPINHA DO CARD e o`
  + ' MAPA AMPLIADO desenhando tile (com contraprova que vai a zero), mapa intacto com o'
  + ' toggle desligado e com o cache cheio, fila em IndexedDB, sufixo da foto como contrato'
  + ' (app E card), varredura enchendo e servindo do cache sem rede, abertura offline,'
  + ' card de foto que AVISA quando a foto não veio e MOSTRA quando veio, a foto guardada sendo a'
  + ' EM DECISÃO (e o app reaberto sem rede achando-a — num contexto à parte, com o SW fora, pelo'
  + ' cache HTTP como no aparelho), A ESTRADA inteira (com pedidos DE FOTO) (encher, modo avião com foto e mapa vindo do cache, 6 ações enfileiradas e a rede voltando pra drenar), o reporte de caixa CURTA achando todos os tiles (com a troca de zoom como pré-condição), o service worker ENCERRADO acordando sabendo dos tiles (com controle de que foi mesmo encerrado), a preparação INTERROMPIDA deixando o mapa guardado visível (com controle de que foi parcial e de que o worker não renasceu), o DEPLOY não apagando o mapa provisionado (com o cache de versão velho sumindo como controle), o DIAGNÓSTICO enxergando o offline (rede no diário e na captura, seção offline, o worker respondendo por si, as duas sentinelas novas dos dois lados, o teto da lista de recursos com controle, e o envio do beacon da borda fora do código conferido), esquecer PARANDO o download em voo, e o que foi TRATADO não voltando como card (decidir e reabrir sem rede em página nova, a ação na janela do Desfazer ao fechar, e a busca com rede correndo junto do esvaziamento — com a fila guardada intacta como controle), a fila guardada entrando com a REDE QUE NÃO ANDA e com a ORIGEM FORA DO AR (502 na página, nos scripts e na API), também com "Minha área" (a busca esperando o perfil que não responde), DUAS ABAS esvaziando a fila de saída uma de cada vez (com a trava do navegador e sem ela), a foto quebrada no FIM da fila deixando a preparação PRONTA pela sonda da rede (e parcial com a rede caindo, como controle), e o card de FOTO no lie-fi travando ✕/✓ (e sem trava com a foto chegando), DUAS ABAS no diagnóstico (a poda pela hora da CAPTURA, a outra aba marcada no relatório e na triagem, e a sentinela do pedido decidido calada, com o CONTROLE do pedido que entra de novo) o FAB do modo dev fora do "Restam" com o banner do topo na tela (com o CONTROLE do FAB posto à força no canto de cima), o card de foto redesenhado pela rede de volta com o teclado no ↑ (com o CONTROLE de que o card foi trocado) e destravando NA HORA com a rede provada e a prova da foto presa (com o CONTROLE da trava sem a prova de rede), e o RELATÓRIO com a aba mais velha que fechou antes dele marcada como outra aba e feito DENTRO do treino com a fila real (com o CONTROLE do appState só de exemplos), e — depois da TROCA DE CONTA — levando o código da página (com a lista de recursos sem ele como pré-condição), as telas da OUTRA aba entregues no relatório desta (com o CONTROLE da tela feita depois), o card de foto destravando NA HORA com a rede provada ANTES da prova, e o FAB fora do "N esperando envio" no computador (com o CONTROLE do FAB forçado em cima dele), e a captura do arraste sem acusar o FAB que espera o gesto (com o CONTROLE do FAB saindo quando o dedo solta)');
