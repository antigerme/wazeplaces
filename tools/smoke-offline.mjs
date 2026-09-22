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
// A ÚNICA exceção é a seção 6c: ela BLOQUEIA o service worker e não registra
// rota nenhuma, porque é o único jeito de medir a foto no cache HTTP do
// navegador — qualquer rota no contexto desliga esse cache (ver lá).
//
// Regra que vale pra todo caso aqui: medir FATO, não intenção. Guard de fonte
// não enxerga CSP, não enxerga cache e não enxerga service worker.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as dormir } from 'node:timers/promises';
import { esperarFimDaSaida, esperarNaPagina } from './esperar-saida.mjs';

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
  let alvo = null;
  try { alvo = tentar(); } catch (e) { erros.push(String(e.message || e).slice(0, 90)); continue; }
  let mod = null;
  try { mod = await import(alvo); }
  catch (e) { erros.push(String(e.message || e).slice(0, 90)); continue; }
  // O pacote PUBLICADO é CJS (`index.js`): `import()` por CAMINHO devolve um
  // namespace só com `default`, e `mod.chromium` vem UNDEFINED. Sem tratar
  // isso, a primeira tentativa — a que existe justamente pra honrar o
  // playwright FIXADO no repo (o do CI) — falhava CALADA e o laço caía no
  // global do sandbox. Medido em 2026-09-22: por caminho as chaves são
  // `default`; por especificador BARE vêm os nomeados. Era por isso que
  // "não reproduz aqui" não queria dizer nada — aqui rodava 1.56 e o CI 1.49.
  const pw = mod && mod.chromium ? mod : (mod && mod.default) || {};
  if (pw.chromium) { chromium = pw.chromium; break; }
  erros.push(`${alvo}: importou sem 'chromium' (chaves: ${Object.keys(mod || {}).join(', ')})`);
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
// Pedido SEM foto: aí o mapa é o PRIMEIRO slide e nasce visível. Com foto, quem
// abre é a foto e o `.card-map` nasce `hidden` — medir o mapa ali daria zero
// com a app certa, que é medir outra coisa (`mapaVemPrimeiro()` decide).
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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 },
  serviceWorkers: 'allow', locale: 'pt-BR', colorScheme: 'dark' });
let rotaTile = 0;
// Handler NOMEADO de propósito: a contraprova da seção 1 precisa DESLIGAR o
// tile e religá-lo, e `unroute` sem a referência derruba tudo que casa com o
// padrão — inclusive o que as seções seguintes dependem.
let aviao = false;   // modo avião DE VERDADE é abort + setOffline (gotcha #28)
const servirTile = (r) => { if (aviao) return r.abort('internetdisconnected'); rotaTile++;
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
// atrás de um `EvalError` que a app não podia produzir (ela não tem `eval`).
let secaoAtual = 'abertura';
const secao = (nome) => { secaoAtual = nome; console.log(`\n\u2500\u2500 ${nome} \u2500\u2500`); };
const errosJs = [];
const violacoes = [];
page.on('pageerror', (e) => errosJs.push({ secao: secaoAtual, txt: String(e.message) }));
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
// MAPINHA QUE A APP DESENHA — que é o que sumiu da tela de quem nunca ligou o
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

secao('6. O CARD DE FOTO SEM REDE: a foto que VEIO aparece, a que NÃO VEIO avisa');
// ESTA SEÇÃO EXIGIA O DEFEITO COMO CORRETO. Ela montava um card de FOTO sem rede
// e cobrava o aviso "precisa de sinal" — sem nunca perguntar se a foto estava
// guardada. A app, igual: o aviso nascia por SUPOSIÇÃO (`offline` + tipo de foto)
// e escondia a foto que a varredura tinha acabado de guardar pra este momento.
// RELATADO pelo owner no Android, com a varredura em "Pronto" 1 minuto antes: os
// três cards de "Nova foto" vieram vazios. E o diagnóstico dele PROVA que o
// cache funcionou: as três fotos estão `quebrada: false`, com o sufixo certo,
// em momentos capturados SEM REDE — a app só as escondia.
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
// 6b) a foto CHEGA — o defeito que chegou aos testadores
await montar([{ ...PLACE(10, 'NEW_PHOTO'), imageUrls: [BASE + '/icons/screenshots/previa-card.jpg'] }]);
await esperarNaPagina(page, () => { const i = document.querySelector('#cardStack .place-card:not(.card-fundo) .card-image');
  return !!(i && i.naturalWidth > 0); }, 8000);
await dormir(400);   // folga pra um aviso tardio aparecer, se o defeito voltar
const comFotoCard = await lerFotoDoCard();
diz('a foto CHEGOU: ela aparece no card de foto, sem aviso', comFotoCard.fotoVisivel && !comFotoCard.temAviso,
  JSON.stringify(comFotoCard));
diz('e o ✕ fica vivo — há foto pra decidir', !comFotoCard.rejTravado && !comFotoCard.lidoTravado,
  JSON.stringify(comFotoCard));
aviao = false;
await ctx.setOffline(false);

secao('6c. A FOTO GUARDADA É A FOTO EM DECISÃO — e a app REABERTA sem rede a encontra');
// DOIS defeitos, e os dois só aparecem no card de FOTO SEM REDE:
//  1. A varredura guardava `imageUrls[0]`, e o card de foto abre na foto EM
//     DECISÃO (a proposta ou a denunciada). MEDIDO na fila do owner: em 13 de
//     76 pedidos de foto ela NÃO é a primeira — o card abria na que ninguém
//     guardou, com "a foto precisa de sinal" e ✕/✓ travados.
//  2. A janela do sufixo (`?w=`) morava só em memória. A app REABERTA sem rede
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

// CONTROLE DO INSTRUMENTO nos dois sentidos, antes de medir a app: sem rede,
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

// A app RENASCE sem rede: nada em memória, nem a fila nem a janela. É o
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

aviao = true; await ctx.setOffline(true);
const tileAntes = rotaTile;
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
// de rede, a abertura da app. O teste dava UM gatilho só, então qualquer
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
// reprovar justamente pelo comportamento que a app promete. Quem guarda o
// desperdício é o bloco da fila de saída no `smoke-browser.mjs` ("UMA
// requisição por ação"); quem guarda o que importa aqui é a linha de baixo —
// o placar NÃO pode contar duas vezes, e essa segue exata.
const saiuMesmo = api.filter((u) => /validar-place/.test(u) && !/AVIAO/.test(u)).length;
diz('a fila de saída ESVAZIOU quando a rede voltou', depoisDaEstrada.fila === 0, JSON.stringify(depoisDaEstrada));
diz(`as 6 saíram de verdade PELA REDE (${saiuMesmo} tentativas)`, saiuMesmo >= 6, JSON.stringify(api.slice(-3)));
diz('o placar não contou duas vezes', depoisDaEstrada.rej === 6, 'rejeitados=' + depoisDaEstrada.rej);
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
//     na registração que a app criou no `load`, não na que o teste provocou.
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
// A troca de controller RECARREGA a página (o auto-update da app fazendo o que
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

// A troca de controller RECARREGA a página (é o auto-update da app fazendo o
// que promete). Espere ela assentar e devolva o estado que a seção seguinte
// precisa — sem isto o `offlineVarrer()` de lá roda com fila vazia e a
// asserção "o cache ficou vazio" passa por vácuo.
await page.waitForLoadState('load').catch(() => {});
await esperarNaPagina(page, () => typeof offlineVarrer === 'function', 20000);
await page.evaluate(() => { AppState.preferences.offlineDisponivel = true; }).catch(() => {});
await montar([PLACE(1), PLACE(2), PLACE(3)]);

secao('9. ESQUECER PARA a varredura em voo (privacidade)');
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

secao('10. NADA DE ERRO, NADA DE CSP');
diz('nenhum erro de JS em todo o percurso', errosJs.length === 0, JSON.stringify(errosJs.slice(0, 3)));
diz('nenhuma violação de CSP', violacoes.length === 0, JSON.stringify(violacoes.slice(0, 3)));

await browser.close();
servidor.kill();
if (falhas) {
  console.log(`\n✗ smoke do offline: ${falhas} falha(s)`);
  process.exit(1);
}
console.log('\n✓ smoke do offline: 14 seções (13 com o service worker LIGADO) — o MAPINHA DO CARD e o'
  + ' MAPA AMPLIADO desenhando tile (com contraprova que vai a zero), mapa intacto com o'
  + ' toggle desligado e com o cache cheio, fila em IndexedDB, sufixo da foto como contrato'
  + ' (app E card), varredura enchendo e servindo do cache sem rede, abertura offline,'
  + ' card de foto que AVISA quando a foto não veio e MOSTRA quando veio, a foto guardada sendo a'
  + ' EM DECISÃO (e a app reaberta sem rede achando-a — num contexto à parte, com o SW fora, pelo'
  + ' cache HTTP como no aparelho), A ESTRADA inteira (com pedidos DE FOTO) (encher, modo avião com foto e mapa vindo do cache, 6 ações enfileiradas e a rede voltando pra drenar), o reporte de caixa CURTA achando todos os tiles (com a troca de zoom como pré-condição), o service worker ENCERRADO acordando sabendo dos tiles (com controle de que foi mesmo encerrado), o DEPLOY não apagando o mapa provisionado (com o cache de versão velho sumindo como controle), e esquecer PARANDO o download em voo');
