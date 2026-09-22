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
// Pedido SEM foto: aí o mapa é o PRIMEIRO slide e nasce visível. Com foto, quem
// abre é a foto e o `.card-map` nasce `hidden` — medir o mapa ali daria zero
// com a app certa, que é medir outra coisa (`mapaVemPrimeiro()` decide).
const SO_MAPA = (i) => ({ ...PLACE(i), imageUrls: [], imageUrl: null });
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

console.log('\n── 1b. O MAPA AMPLIADO (o outro lugar em que o tile aparece) ──');
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

console.log('\n── 5. ABRIR SEM REDE ──');
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

console.log('\n── 7. A ESTRADA: marco o toggle, encho, entro no avião e volto ──');
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
const FOTOS_REAIS = ['/icons/splash/splash-750x1334-dark.png',
  '/icons/splash/splash-750x1334-light.png', '/icons/splash/splash-828x1792-light.png'];
const ESTRADA = Array.from({ length: 12 }, (_, k) => {
  const p = PLACE(40 + k);
  return k % 2 === 0 ? { ...p, imageUrls: [BASE + FOTOS_REAIS[k % 3]] }
                     : { ...p, imageUrls: [], imageUrl: null };
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
await page.waitForFunction(() => offlineUltimoResultado !== null, { timeout: 120000, polling: 250 }).catch(() => {});
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
    // `.card-image` existe SEMPRE no template — quem diz se há foto é o src.
    const src = foto ? String(foto.getAttribute('src') || '') : '';
    const box = card && card.querySelector('.card-map');
    const tl = box ? [...box.querySelectorAll('.card-map-tiles img')] : [];
    const rej = card && card.querySelector('.card-btn-reject');
    return { temFoto: !!src && !foto.classList.contains('hidden'),
      fotoOk: !!(foto && foto.naturalWidth > 0), tiles: tl.length,
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
diz(`as fotos guardadas abriram SEM REDE (${comFoto.filter((v) => v.fotoOk).length}/${comFoto.length})`,
  comFoto.length > 0 && comFoto.every((v) => v.fotoOk), JSON.stringify(naEstrada));
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
await page.waitForFunction(() => { try {
  return JSON.parse(localStorage.getItem('waze_places_saida') || '[]').length === 0; } catch (e) { return false; } },
  { timeout: 60000, polling: 250 }).catch(() => {});
const depoisDaEstrada = await page.evaluate(() => ({
  fila: JSON.parse(localStorage.getItem('waze_places_saida') || '[]').length,
  rej: AppState.stats.rejected }));
const saiuMesmo = api.filter((u) => /validar-place/.test(u) && !/AVIAO/.test(u)).length;
diz('a fila de saída ESVAZIOU quando a rede voltou', depoisDaEstrada.fila === 0, JSON.stringify(depoisDaEstrada));
diz(`as 6 saíram de verdade PELA REDE (${saiuMesmo})`, saiuMesmo === 6, JSON.stringify(api.slice(-3)));
diz('o placar não contou duas vezes', depoisDaEstrada.rej === 6, 'rejeitados=' + depoisDaEstrada.rej);
await ctx.unroute('**/api/*', rotaApi);
await page.evaluate(() => { API.setSession(null); });

console.log('\n── 8. O DEPLOY NÃO APAGA O MAPA PROVISIONADO ──');
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
await page.waitForFunction(() => typeof offlineVarrer === 'function',
  { timeout: 20000, polling: 200 }).catch(() => {});
await page.evaluate(() => { AppState.preferences.offlineDisponivel = true; }).catch(() => {});
await montar([PLACE(1), PLACE(2), PLACE(3)]);

console.log('\n── 9. ESQUECER PARA a varredura em voo (privacidade) ──');
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

console.log('\n── 10. NADA DE ERRO, NADA DE CSP ──');
diz('nenhum erro de JS em todo o percurso', errosJs.length === 0, errosJs[0] || '');
diz('nenhuma violação de CSP', violacoes.length === 0, violacoes[0] || '');

await browser.close();
servidor.kill();
if (falhas) {
  console.log(`\n✗ smoke do offline: ${falhas} falha(s)`);
  process.exit(1);
}
console.log('\n✓ smoke do offline: 11 seções com o service worker LIGADO — o MAPINHA DO CARD e o'
  + ' MAPA AMPLIADO desenhando tile (com contraprova que vai a zero), mapa intacto com o'
  + ' toggle desligado e com o cache cheio, fila em IndexedDB, sufixo da foto como contrato'
  + ' (app E card), varredura enchendo e servindo do cache sem rede, abertura offline,'
  + ' card de foto travado com o ↑ vivo, A ESTRADA inteira (encher, modo avião com foto e mapa vindo do cache, 6 ações enfileiradas e a rede voltando pra drenar), o DEPLOY não apagando o mapa provisionado (com o cache de versão velho sumindo como controle), e esquecer PARANDO o download em voo');
