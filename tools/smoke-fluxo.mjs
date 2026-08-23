#!/usr/bin/env node
// Smoke de FLUXO: a app como MÁQUINA DE ESTADOS, não como coleção de telas.
//
// POR QUE ESTE ARQUIVO EXISTE, com os dois defeitos que o motivaram:
//
//   · renomeando um local, TROCAR DE FOTO fazia a lixeira/aprovar reaparecerem
//     — logo abaixo do confirmar/cancelar do nome, e as duas gravam no mapa;
//   · com o foco no campo do nome, as SETAS trocavam a foto em vez de andar o
//     cursor (a guarda existia, mas depois de um `return` que vinha antes).
//
// Nenhum dos dois apareceria numa auditoria de tela, e não apareceu: o
// `smoke-browser.mjs` mede 960 renders e passou verde nos dois. Eles só existem
// quando DOIS estados coexistem (renomear + carrossel; campo focado + teclado).
// Cobertura de tela não é cobertura de fluxo.
//
// COMO ELE FUNCIONA, e por que não é uma lista de casos que eu imaginei:
// declaro os ESTADOS que podem coexistir e as INVARIANTES que valem em qualquer
// combinação deles; o explorador faz o produto e cobra. Bug que eu não imaginei
// ainda cai, desde que viole uma invariante.
//
// Mora em `tools/` e não em `test/` pelo mesmo motivo do smoke de layout: o
// `node --test` varre `test/` inteiro, e isto precisa de browser — dentro de
// `test/` quebraria a promessa de suíte com zero dependência.

import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.PORTA_FLUXO || 8188);
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
    console.error(`  Ou rode noutra porta: PORTA_FLUXO=8190 npm run test:fluxo`);
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
  await new Promise((k) => setTimeout(k, 250));
}
if (morreuCedo !== null) {
  console.error(`\n✗ o servidor do teste morreu ao subir (código ${morreuCedo}).`);
  console.error(`  Quase sempre é a porta ${PORTA} ocupada por um processo esquecido.`);
  console.error('  Confira com: ps -eo pid,args | grep "[s]erver/node.mjs"');
  console.error('  Ou rode noutra porta: PORTA_FLUXO=8190 npm run test:fluxo');
  process.exit(1);
}
if (!vivo) { console.error(`\n✗ o servidor não respondeu em ${BASE} depois de 15s.`); process.exit(1); }

// ── o pedido usado em tudo ─────────────────────────────────────────────────
// Precisa de NOME (renomear só corrige nome existente), local APROVADO (o Waze
// recusa escrita em não-aprovado), VÁRIAS fotos (o carrossel é metade dos
// defeitos) e MAPA (pro mapa ampliado ser um estado alcançável).
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#8a8a8a"/></svg>';
const FIXTURES = JSON.parse(readFileSync(join(ROOT, 'tools', 'fixtures-paises.json'), 'utf8'));
const baseFix = FIXTURES.find((f) => f.name && f.mapa && f.mapa.centro) || FIXTURES.find((f) => f.name);

// As fotos precisam de ID DENTRO DA URL: `idFotoAtual()` acha a foto atual
// procurando um `approvedImageIds` que apareça na url, e sem isso a LIXEIRA
// nunca aparece — o teste passaria por ausência, medindo o meu stub em vez do
// botão (gotcha #52: fixture define o que o teste é capaz de enxergar).
// Data URI não serve, porque não tem onde pendurar o id. Vira URL de verdade,
// que o `page.route` responde com o SVG.
const IDS_FOTO = ['fotoAAAA1111', 'fotoBBBB2222', 'fotoCCCC3333'];
const URLS_FOTO = IDS_FOTO.map((id) => `${BASE}/__stub__/${id}.jpg`);
const PEDIDO = {
  ...baseFix,
  name: baseFix.name || 'Padaria do Zé',
  localAprovado: true,
  lat: (baseFix.mapa && baseFix.mapa.centro && baseFix.mapa.centro[0]) || -23.5,
  lon: (baseFix.mapa && baseFix.mapa.centro && baseFix.mapa.centro[1]) || -46.6,
  imageUrl: URLS_FOTO[0],
  imageUrls: [...URLS_FOTO],
  // A 2ª e a 3ª sao APROVADAS (dao lixeira); a 1ª e a proposta (da o aprovar).
  approvedImageIds: [IDS_FOTO[1], IDS_FOTO[2]],
  imageDates: {},
};

// ── OS CONTROLES QUE GRAVAM NO WAZE ────────────────────────────────────────
// A lista existe pra que "nada escreve neste estado" seja verificável, e não
// uma frase. Controle novo que grave entra AQUI — senão ele nasce sem cobertura.
const ESCRITA = [
  { sel: '.card-btn-reject', nome: 'rejeitar (card)', grupo: 'card' },
  { sel: '.card-btn-read', nome: 'marcar lido (card)', grupo: 'card' },
  { sel: '#lightboxDelete', nome: 'excluir foto', grupo: 'foto' },
  { sel: '#lightboxApprove', nome: 'aprovar foto', grupo: 'foto' },
  { sel: '#lightboxNomeOk', nome: 'confirmar nome', grupo: 'nome' },
];

// Endpoints que ALTERAM dado real no Waze. Nenhum pode ser chamado nos estados
// bloqueados — e isto se mede na REDE, não no atributo `disabled`: atributo é a
// intenção, requisição é o que aconteceu.
const ENDPOINTS_DE_ESCRITA = ['validar-place', 'marcar-lido', 'excluir-foto', 'renomear-local'];

// ── ESTADOS QUE PODEM COEXISTIR ────────────────────────────────────────────
//
// A app bloqueia de DUAS formas, e as duas são desenho, não acidente:
//
//   `some`       — o controle sai da tela. É o certo quando a ação não existe
//                  naquele contexto (no treino nada escreve; renomeando, as
//                  ações de foto ficariam no mesmo canto do confirmar/cancelar).
//                  "Desabilitado" ali convidaria à pergunta "por que não posso?",
//                  que não tem resposta boa.
//   `desabilita` — o controle FICA na tela, `disabled` e esmaecido. É o certo
//                  na janela do Desfazer: a ação existe e volta em 3s, e sumir
//                  com os botões faria a barra pular na cara de quem está
//                  triando. Botão travado tem que PARECER travado.
//
// Conflatar os dois foi meu erro na primeira versão: exigir "fora da tela" na
// janela do Desfazer acusou 377 falhas em cima do comportamento CERTO.
const ESTADOS = [
  {
    nome: 'treino',
    // O treino usa pedidos INERTES: os botões do card seguem clicáveis (é o
    // ponto), mas nada de foto/nome pode escrever no mapa.
    some: ['foto', 'nome'],
    entrar: 'Treino.entrar()',
    sair: 'Treino.sair()',
    ativo: 'Treino.ativo === true',
  },
  {
    nome: 'lightbox',
    bloqueia: [],
    entrar: '__fx.abrirLightbox()',
    sair: 'Lightbox.close()',
    ativo: 'Lightbox.isOpen()',
  },
  {
    nome: 'renomeando',
    requer: ['lightbox'],
    // As duas ações de foto ficam no MESMO canto do confirmar/cancelar do nome.
    some: ['foto'],
    entrar: 'abrirEdicaoNome()',
    sair: 'fecharEdicaoNome()',
    ativo: 'editandoNome()',
  },
  {
    nome: 'mapaAmpliado',
    bloqueia: [],
    entrar: '__fx.abrirMapa()',
    sair: 'MapaLightbox.close()',
    ativo: 'MapaLightbox.isOpen()',
  },
  {
    nome: 'desfazerCorrendo',
    // A janela do Desfazer trava TUDO: se ela não travar, o teclado ou o
    // lightbox viram atalho pra furar o que o dedo respeita. Aqui é DESABILITA
    // e não some: a ação volta em 3s, e sumir com a barra faria o layout pular.
    desabilita: ['card', 'foto', 'nome'],
    entrar: '__fx.abrirJanelaDesfazer()',
    sair: '__fx.fecharJanelaDesfazer()',
    ativo: 'acoesTravadas()',
  },
  {
    nome: 'filaVazia',
    // Sem card na tela não há botão de card: o controle nem existe.
    some: ['card'],
    entrar: '__fx.esvaziarFila()',
    sair: '__fx.encherFila()',
    ativo: 'AppState.queue.length === 0',
  },
  {
    nome: 'deslogado',
    some: ['card', 'foto', 'nome'],
    entrar: '__fx.deslogar()',
    sair: '__fx.relogar()',
    ativo: 'AppState.authenticated === false',
  },
  { nome: 'modalFiltros', bloqueia: [], entrar: "openModal('filtersModal')", sair: "closeModal('filtersModal')", ativo: "!document.getElementById('filtersModal').classList.contains('hidden')" },
  { nome: 'modalAjuda', bloqueia: [], entrar: "openModal('helpModal')", sair: "closeModal('helpModal')", ativo: "!document.getElementById('helpModal').classList.contains('hidden')" },
  { nome: 'modalSair', bloqueia: [], entrar: "openModal('logoutModal')", sair: "closeModal('logoutModal')", ativo: "!document.getElementById('logoutModal').classList.contains('hidden')" },
  { nome: 'modalLote', bloqueia: [], entrar: "openModal('batchReadModal')", sair: "closeModal('batchReadModal')", ativo: "!document.getElementById('batchReadModal').classList.contains('hidden')" },
  { nome: 'modalPareamento', bloqueia: [], entrar: "openModal('pairEnterModal')", sair: "closeModal('pairEnterModal')", ativo: "!document.getElementById('pairEnterModal').classList.contains('hidden')" },
];

// ── AÇÕES QUE NÃO PODEM MUDAR O QUE ESTÁ BLOQUEADO ─────────────────────────
//
// ESTA É A PEÇA QUE FALTAVA, e descobri isso do jeito certo: montei o teste,
// revertí o conserto de hoje pra ver se ele reprovava — e ELE PASSOU. Modelar
// só "estados que coexistem" não bastava, porque o defeito real era
// estado + AÇÃO: renomeando, TROCAR DE FOTO reacendia a lixeira/aprovar.
//
// Entrar nos dois estados não reproduz nada. O que reproduz é entrar e depois
// SACUDIR — fazer a app se redesenhar. Toda ação abaixo é coisa que o editor
// faz o tempo todo e que, por desenho, não pode mexer no que está bloqueado.
// Ação nova que redesenhe entra aqui.
const ACOES_NEUTRAS = [
  { nome: 'trocar de foto (→ e ←)', fazer: 'Lightbox.isOpen() && (Lightbox.next(), Lightbox.prev())' },
  { nome: 'avançar duas fotos', fazer: 'Lightbox.isOpen() && (Lightbox.next(), Lightbox.next())' },
  { nome: 'redesenhar o card', fazer: 'AppState.currentPlace && showCurrentPlace()' },
  { nome: 'atualizar o placar', fazer: 'updateStats(), updatePendingCount()' },
  { nome: 'trocar de idioma', fazer: "typeof setLang === 'function' && (setLang('en'), applyI18n())" },
  { nome: 'trocar de tema', fazer: "typeof applyTheme === 'function' && applyTheme('light')" },
];

for (const e of ESTADOS) { e.some = e.some || []; e.desabilita = e.desabilita || []; e.bloqueia = [...e.some, ...e.desabilita]; }
const porNome = Object.fromEntries(ESTADOS.map((e) => [e.nome, e]));

// ── as ferramentas que rodam DENTRO da página ──────────────────────────────
const FERRAMENTAS = (PEDIDO_JSON) => {
  const PL = JSON.parse(PEDIDO_JSON);
  const clone = () => JSON.parse(JSON.stringify(PL));
  window.__fx = {
    pedido: PL,
    montar() {
      // SEM TOKEN, `API.markAsRead` e companhia retornam ANTES de tocar a rede
      // (`if (!sessionToken) return`). Sem isto, "zero escrita no fio" passava
      // por VÁCUO: nada escreveria em estado nenhum, e o teste diria que a app
      // está protegida quando na verdade está apenas deslogada. Foi o CONTROLE
      // da rede que pegou — é literalmente pra isso que ele existe.
      API.setSession('token-de-teste-do-smoke-de-fluxo');
      AppState.authenticated = true;
      AppState.profile = { userName: 'a', username: 'a', rank: 5, isAreaManager: true, isStaff: false, areas: [] };
      document.getElementById('authScreen').classList.add('hidden');
      document.getElementById('appScreen').classList.remove('hidden');
      document.getElementById('noMoreCards')?.classList.add('hidden');
      showLoading(false);
      AppState.queue = [clone(), clone()];
      AppState.queue[1].venueID = 'segundo';
      AppState.queue[1].updateRequestID = 'segundo';
      AppState.currentPlace = AppState.queue[0];
      AppState.serverTotal = 2;
      AppState.hasMore = false;
      showCurrentPlace();
      updateStats();
      updatePendingCount();
    },
    abrirLightbox() {
      const p = AppState.currentPlace || PL;
      Lightbox.open(p.imageUrls, 0, 0, p.name, false, p);
    },
    abrirMapa() {
      const p = AppState.currentPlace || PL;
      if (typeof MapaLightbox === 'undefined' || !p.mapa) return false;
      MapaLightbox.open(p);
      return MapaLightbox.isOpen();
    },
    abrirJanelaDesfazer() {
      // "Pular" é a ação mais barata que abre a janela e não depende de rede.
      AppState.preferences.undoEnabled = true;
      handleSkip();
      return !!AppState.pendingAction;
    },
    fecharJanelaDesfazer() {
      // DESFAZER, e não deixar vencer: vencer DESPACHA a ação, que é escrita.
      if (AppState.pendingAction) {
        AppState.pendingAction.undo();
        AppState.pendingAction = null;
        if (typeof removeUndoBanner === 'function') removeUndoBanner();
      }
    },
    esvaziarFila() {
      AppState.queue = [];
      AppState.currentPlace = null;
      AppState.serverTotal = 0;
      document.querySelectorAll('.place-card').forEach((e) => e.remove());
      updatePendingCount();
    },
    encherFila() { this.montar(); },
    deslogar() {
      AppState.authenticated = false;
      document.getElementById('appScreen').classList.add('hidden');
      document.getElementById('authScreen').classList.remove('hidden');
      updatePendingCount();
    },
    relogar() { this.montar(); },

    // ── a medição ────────────────────────────────────────────────────────
    // ALCANÇÁVEL = existe, visível, habilitado, dentro da tela E recebe o
    // toque. Medir só `.hidden` deixaria passar botão coberto por outra caixa
    // (gotcha #26) e botão `disabled` com cara de vivo.
    alcancavel(sel) {
      const e = document.querySelector(sel);
      if (!e) return { existe: false, alcancavel: false };
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      const visivel = !e.classList.contains('hidden') && cs.display !== 'none'
        && cs.visibility !== 'hidden' && cs.opacity !== '0' && r.width > 0 && r.height > 0;
      const naTela = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      const desabilitado = !!e.disabled || e.getAttribute('aria-disabled') === 'true';
      let recebeToque = false, ladrao = null;
      if (visivel && naTela) {
        const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        recebeToque = !!(t && (t === e || e.contains(t)));
        if (!recebeToque && t) ladrao = (t.className || t.tagName).toString().slice(0, 40);
      }
      return {
        existe: true, visivel, naTela, desabilitado, recebeToque, ladrao,
        // ALCANÇÁVEL exige receber o toque; PRESENTE basta estar na tela.
        //
        // Pra ação DESTRUTIVA num estado bloqueado, o que vale é PRESENTE, e
        // isso eu aprendi errando: com o bug reintroduzido, o aprovar ficava
        // visível mas o hit-test caía num SVG dos botões do nome por cima — o
        // medidor dizia "bloqueado" e o teste passava verde COM o defeito. Só
        // que estar desenhado ali JÁ é o perigo (foi essa a queixa: "aparece
        // logo abaixo do confirmar/cancelar"), e num aparelho de outra medida
        // ele sobra pra fora e vira tocável. Exigir tocável mede a MINHA
        // viewport, não o defeito.
        presente: visivel && naTela,
        alcancavel: visivel && naTela && !desabilitado && recebeToque,
        // Botão morto com cara de vivo lê como app quebrada: `disabled` sem
        // esmaecer engana o olho, esmaecido sem `disabled` engana o Tab.
        opacidade: parseFloat(cs.opacity),
      };
    },
    estado(expr) { try { return !!eval(expr); } catch (e) { return 'ERRO:' + String(e.message).slice(0, 40); } },
  };
};

// ── execução ───────────────────────────────────────────────────────────────
let falhas = 0;
const dizer = (msg, det) => { falhas++; console.log(`  ✗ ${msg}${det ? ' — ' + det : ''}`); };

const browser = await chromium.launch();

async function novaPagina() {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block', locale: 'pt-BR' });
  const page = await ctx.newPage();
  const errosJs = [];
  const escritas = [];
  page.on('pageerror', (e) => errosJs.push(String(e).slice(0, 140)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errosJs.push('console: ' + m.text().slice(0, 140)); });
  // Toda chamada de ESCRITA é registrada e respondida aqui — assim o teste mede
  // o que SAIU, e nada toca o Waze de verdade.
  await page.route('**/__stub__/**', (route) => route.fulfill({
    status: 200, contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#8a8a8a"/></svg>',
  }));
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const alvo = ENDPOINTS_DE_ESCRITA.find((n) => url.includes(n));
    if (alvo) escritas.push(alvo);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, places: [], hasMore: false, total: 0 }) });
  });
  await page.addInitScript(() => localStorage.setItem('waze_places_preferences',
    JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true, undoGateSeen: true, presenca: false })));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(450);
  await page.evaluate(FERRAMENTAS, JSON.stringify(PEDIDO));
  await page.evaluate(() => __fx.montar());
  await page.waitForTimeout(250);
  return { ctx, page, errosJs, escritas };
}

const entrar = async (page, nome) => {
  const e = porNome[nome];
  await page.evaluate((expr) => { eval(expr); }, e.entrar);
  await page.waitForTimeout(180);
  return page.evaluate((expr) => __fx.estado(expr), e.ativo);
};
const sair = async (page, nome) => {
  const e = porNome[nome];
  await page.evaluate((expr) => { try { eval(expr); } catch (err) { /* já fechado */ } }, e.sair);
  await page.waitForTimeout(180);
};
const medir = (page, sel) => page.evaluate((s) => __fx.alcancavel(s), sel);

// ═══ 1. CONTROLE: no estado NEUTRO, cada controle de escrita é ALCANÇÁVEL ═══
// Sem isto o teste inteiro passaria por ausência — "nada alcançável" seria
// verdade porque nada nunca aparece. Guard que nunca viu o alvo não guarda nada.
console.log('\n1. CONTROLE — cada ação de escrita EXISTE e é alcançável no estado neutro');
{
  const { ctx, page } = await novaPagina();
  for (const c of ESCRITA) {
    // Cada uma precisa do seu estado mínimo: as de foto/nome exigem o lightbox.
    if (c.grupo === 'foto' || c.grupo === 'nome') await entrar(page, 'lightbox');
    // A lixeira so existe em foto APROVADA e o aprovar so na PROPOSTA: sao
    // mutuamente exclusivos de proposito, entao o controle navega ate a certa.
    if (c.sel === '#lightboxDelete') { await page.evaluate(() => Lightbox.next()); await page.waitForTimeout(150); }
    if (c.grupo === 'nome') await entrar(page, 'renomeando');
    if (c.grupo === 'nome') {
      // O confirmar só habilita com nome DIFERENTE — senão não é renomeação.
      await page.evaluate(() => {
        const i = document.getElementById('lightboxNomeInput');
        i.value = i.value + ' X';
        i.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(120);
    }
    const m = await medir(page, c.sel);
    if (!m.alcancavel) dizer(`controle: "${c.nome}" não é alcançável nem no estado neutro`, JSON.stringify(m));
    else console.log(`  ok ${c.nome}`);
    if (c.grupo === 'nome') await sair(page, 'renomeando');
    if (c.grupo === 'foto' || c.grupo === 'nome') await sair(page, 'lightbox');
  }
  await ctx.close();
}

// ═══ 2. UM ESTADO POR VEZ: o que ele bloqueia fica INALCANÇÁVEL ═══════════
console.log('\n2. ESTADO SOZINHO — o que ele bloqueia não pode estar alcançável');
for (const est of ESTADOS.filter((e) => e.bloqueia.length)) {
  const { ctx, page, errosJs } = await novaPagina();
  for (const dep of est.requer || []) await entrar(page, dep);
  // Os controles de foto/nome só existem com o lightbox aberto: sem abrir, o
  // teste diria "bloqueado" pra um botão que só não estava na tela.
  const precisaLightbox = est.bloqueia.some((g) => g === 'foto' || g === 'nome');
  if (precisaLightbox && !(est.requer || []).includes('lightbox') && est.nome !== 'deslogado') {
    await entrar(page, 'lightbox');
  }
  const entrou = await entrar(page, est.nome);
  if (entrou !== true) { dizer(`${est.nome}: não consegui entrar no estado`, String(entrou)); await ctx.close(); continue; }

  const conferir = async (depoisDe) => {
    for (const c of ESCRITA.filter((x) => est.some.includes(x.grupo))) {
      const m = await medir(page, c.sel);
      if (m.presente) dizer(`${est.nome}${depoisDe}: "${c.nome}" NA TELA (devia SUMIR)`, JSON.stringify(m));
    }
    for (const c of ESCRITA.filter((x) => est.desabilita.includes(x.grupo))) {
      const m = await medir(page, c.sel);
      if (!m.existe || !m.presente) continue;      // sumiu: mais restritivo, tudo bem
      if (!m.desabilitado) dizer(`${est.nome}${depoisDe}: "${c.nome}" na tela e HABILITADO`, JSON.stringify(m));
      // Botão travado tem que PARECER travado: `disabled` sem esmaecer engana o
      // olho, esmaecido sem `disabled` engana o Tab e o leitor de tela.
      else if (m.opacidade >= 0.95) dizer(`${est.nome}${depoisDe}: "${c.nome}" desabilitado com cara de ativo`, `opacidade ${m.opacidade}`);
    }
  };
  await conferir('');
  // E DEPOIS DE SACUDIR: é aqui que mora o defeito que a coexistência sozinha
  // não pega — o redesenho recalculando por cima do que o estado estabeleceu.
  for (const acao of ACOES_NEUTRAS) {
    await page.evaluate((expr) => { try { eval(expr); } catch (e) { /* ação não cabe neste estado */ } }, acao.fazer);
    await page.waitForTimeout(140);
    const segueAtivo = await page.evaluate((expr) => __fx.estado(expr), est.ativo);
    if (segueAtivo !== true) continue;   // a ação encerrou o estado: outro assunto
    await conferir(` após "${acao.nome}"`);
  }
  if (errosJs.length) dizer(`${est.nome}: erro de JS`, errosJs[0]);
  else console.log(`  ok ${est.nome}: some(${est.some.join(',') || '—'}) desabilita(${est.desabilita.join(',') || '—'})`);
  await ctx.close();
}

// ═══ 3. PARES: entrar em A e B, e o bloqueio dos DOIS vale ════════════════
// É aqui que moram os defeitos que a auditoria de tela não pega: um estado
// desfazendo o que o outro estabeleceu.
console.log('\n3. PARES — o bloqueio de cada um continua valendo com o outro junto');
const combinaveis = ESTADOS.filter((e) => e.nome !== 'deslogado');
let pares = 0;
for (let i = 0; i < combinaveis.length; i++) {
  for (let j = 0; j < combinaveis.length; j++) {
    if (i === j) continue;
    const A = combinaveis[i], B = combinaveis[j];
    if ((A.requer || []).includes(B.nome)) continue;     // ordem cuidada abaixo
    if ((B.requer || []).includes(A.nome) && (B.requer || []).length) { /* ok: A antes de B */ }
    const bloqueado = [...new Set([...A.bloqueia, ...B.bloqueia])];
    if (!bloqueado.length) continue;

    const { ctx, page, errosJs } = await novaPagina();
    const precisaLightbox = bloqueado.some((g) => g === 'foto' || g === 'nome');
    const abrir = [];
    for (const dep of [...(A.requer || []), ...(B.requer || [])]) if (!abrir.includes(dep)) abrir.push(dep);
    if (precisaLightbox && !abrir.includes('lightbox') && A.nome !== 'lightbox' && B.nome !== 'lightbox') abrir.push('lightbox');
    for (const d of abrir) await entrar(page, d);

    const okA = await entrar(page, A.nome);
    const okB = await entrar(page, B.nome);
    pares++;
    if (okA !== true || okB !== true) { await ctx.close(); continue; }   // combinação impossível: não é falha

    const somem = [...new Set([...A.some, ...B.some])];
    const desab = [...new Set([...A.desabilita, ...B.desabilita])].filter((g) => !somem.includes(g));
    const conferirPar = async (depoisDe) => {
      for (const c of ESCRITA.filter((x) => somem.includes(x.grupo))) {
        const m = await medir(page, c.sel);
        if (m.presente) dizer(`${A.nome}+${B.nome}${depoisDe}: "${c.nome}" NA TELA (devia SUMIR)`, JSON.stringify(m));
      }
      for (const c of ESCRITA.filter((x) => desab.includes(x.grupo))) {
        const m = await medir(page, c.sel);
        if (m.existe && m.presente && !m.desabilitado) dizer(`${A.nome}+${B.nome}${depoisDe}: "${c.nome}" na tela e HABILITADO`, JSON.stringify(m));
      }
    };
    // Só vale afirmar enquanto os DOIS seguem ativos. Entrar num estado pode
    // ENCERRAR o outro (o treino repõe a fila, então "fila vazia" deixa de ser
    // verdade; e ele descarrega a ação pendente, então a janela do Desfazer
    // fecha) — afirmar sobre um estado que já acabou é medir outra coisa.
    const doisAtivos = async () => (await page.evaluate((e) => __fx.estado(e), A.ativo)) === true
      && (await page.evaluate((e) => __fx.estado(e), B.ativo)) === true;
    if (!(await doisAtivos())) { await ctx.close(); continue; }
    await conferirPar('');
    for (const acao of ACOES_NEUTRAS) {
      await page.evaluate((expr) => { try { eval(expr); } catch (e) { /* não cabe */ } }, acao.fazer);
      await page.waitForTimeout(110);
      const a1 = await page.evaluate((expr) => __fx.estado(expr), A.ativo);
      const b1 = await page.evaluate((expr) => __fx.estado(expr), B.ativo);
      if (a1 !== true || b1 !== true) continue;   // a ação encerrou um dos dois
      await conferirPar(` após "${acao.nome}"`);
    }
    // E SAIR de um não pode destravar o que o outro ainda bloqueia — foi
    // exatamente essa a forma do defeito da renomeação (sair de um estado
    // recalculava por cima do outro).
    await sair(page, B.nome);
    const aindaA = await page.evaluate((expr) => __fx.estado(expr), A.ativo);
    if (aindaA === true) {
      for (const c of ESCRITA.filter((x) => A.some.includes(x.grupo))) {
        const m = await medir(page, c.sel);
        if (m.presente) dizer(`${A.nome}+${B.nome}: sair de ${B.nome} DESTRAVOU "${c.nome}" (${A.nome} segue ativo)`, JSON.stringify(m));
      }
      for (const c of ESCRITA.filter((x) => A.desabilita.includes(x.grupo))) {
        const m = await medir(page, c.sel);
        if (m.existe && m.presente && !m.desabilitado) dizer(`${A.nome}+${B.nome}: sair de ${B.nome} HABILITOU "${c.nome}" (${A.nome} segue ativo)`, JSON.stringify(m));
      }
    }
    if (errosJs.length) dizer(`${A.nome}+${B.nome}: erro de JS`, errosJs[0]);
    await ctx.close();
  }
}
console.log(`  ${pares} pares medidos`);

// ═══ 4. A REDE: no treino e na janela do Desfazer, ZERO escrita sai ════════
// Atributo é intenção; requisição é o que aconteceu. Aqui eu clico de verdade,
// aperto tecla de verdade, e conto o que saiu pelo fio.
console.log('\n4. REDE — clicar e teclar nos estados bloqueados não manda NADA');
for (const est of ['treino', 'desfazerCorrendo']) {
  const { ctx, page, escritas, errosJs } = await novaPagina();
  await entrar(page, 'lightbox');
  const entrou = await entrar(page, est);
  if (entrou !== true) { dizer(`rede/${est}: não entrei no estado`); await ctx.close(); continue; }
  // Clica em tudo que grava, ignorando `disabled` (é justamente o que um dedo
  // apressado faz num botão que ainda não sabe que está morto).
  for (const c of ESCRITA) {
    await page.evaluate((s) => { document.querySelector(s)?.click(); }, c.sel).catch(() => {});
    await page.waitForTimeout(80);
  }
  // E pelo teclado, que é o caminho que já furou a trava uma vez.
  for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp']) { await page.keyboard.press(k); await page.waitForTimeout(80); }
  await page.waitForTimeout(300);
  if (escritas.length) dizer(`rede/${est}: ${escritas.length} chamada(s) de ESCRITA sairam`, [...new Set(escritas)].join(', '));
  else console.log(`  ok ${est}: zero escrita no fio`);
  if (errosJs.length) dizer(`rede/${est}: erro de JS`, errosJs[0]);
  await ctx.close();
}
// CONTROLE da rede: fora dos estados bloqueados, a escrita PRECISA sair —
// senão "zero escrita" seria verdade com a app inteira quebrada.
{
  const { ctx, page, escritas } = await novaPagina();
  // NÃO uso `undoEnabled: false` pra encurtar: o CLAUDE.md avisa que ele
  // sozinho não desliga nada (a cota do `canDisableUndo()` também conta), e eu
  // cai nessa. Aqui a janela CORRE e eu espero ela vencer — que é o caminho
  // real de todo editor e não depende de flag nenhuma.
  await page.evaluate(() => document.querySelector('.card-btn-read')?.click());
  await page.waitForTimeout(4200);   // UNDO_WINDOW_MS = 3000, com folga
  if (!escritas.length) dizer('controle da rede: marcar lido NÃO mandou nada nem com a janela vencida — o teste inteiro estaria medindo uma app morta');
  else console.log(`  ok controle: fora dos bloqueios a escrita sai (${[...new Set(escritas)].join(', ')})`);
  await ctx.close();
}

// ═══ 5. TECLADO: com foco em campo de texto, seta é do CURSOR ═════════════
// Vale em QUALQUER camada com campo, não só na renomeação — que foi onde doeu.
console.log('\n5. TECLADO — foco em campo de texto: a seta é do cursor, em toda camada');
{
  const CAMPOS = [
    { nome: 'renomear (lightbox)', preparar: async (page) => { await entrar(page, 'lightbox'); await entrar(page, 'renomeando'); return '#lightboxNomeInput'; } },
    { nome: 'código de pareamento', preparar: async (page) => { await entrar(page, 'modalPareamento'); return '#pairEnterModal input'; } },
  ];
  for (const campo of CAMPOS) {
    const { ctx, page, errosJs } = await novaPagina();
    const sel = await campo.preparar(page);
    const tem = await page.evaluate((s) => {
      const i = document.querySelector(s);
      if (!i) return false;
      i.focus();
      if (!i.value || i.value.length < 4) { i.value = 'ABCDEF'; i.dispatchEvent(new Event('input', { bubbles: true })); }
      i.setSelectionRange(3, 3);
      return true;
    }, sel);
    if (!tem) { dizer(`teclado/${campo.nome}: campo não encontrado`, sel); await ctx.close(); continue; }
    const antes = await page.evaluate((s) => ({
      cur: document.querySelector(s).selectionStart,
      foto: typeof Lightbox !== 'undefined' ? Lightbox.idx : -1,
      card: AppState.currentPlace?.venueID ?? null,
      fila: AppState.queue.length,
    }), sel);
    // UMA tecla por vez, e conferindo DEPOIS DE CADA UMA. Medir o líquido de
    // ← seguido de → é medir zero: uma desfaz a outra e o índice da foto volta
    // ao mesmo valor. Foi assim que este teste passou verde com o defeito.
    let ok = true;
    const ler = () => page.evaluate((s) => ({
      cur: document.querySelector(s)?.selectionStart ?? null,
      foto: typeof Lightbox !== 'undefined' ? Lightbox.idx : -1,
      card: AppState.currentPlace?.venueID ?? null,
      fila: AppState.queue.length,
      vivo: !!document.querySelector(s),
    }), sel);
    let anterior = antes;
    for (const [k, delta] of [['ArrowLeft', -1], ['ArrowRight', +1], ['ArrowLeft', -1]]) {
      await page.keyboard.press(k);
      await page.waitForTimeout(110);
      const agora = await ler();
      if (!agora.vivo) { dizer(`teclado/${campo.nome}: ${k} FECHOU a camada e sumiu com o campo`); ok = false; break; }
      if (agora.foto !== anterior.foto) { dizer(`teclado/${campo.nome}: ${k} TROCOU a foto`, `${anterior.foto} → ${agora.foto}`); ok = false; }
      if (agora.card !== anterior.card || agora.fila !== anterior.fila) {
        dizer(`teclado/${campo.nome}: ${k} mexeu na FILA`, `${anterior.card}/${anterior.fila} → ${agora.card}/${agora.fila}`); ok = false;
      }
      if (agora.cur !== anterior.cur + delta) {
        dizer(`teclado/${campo.nome}: ${k} não andou o cursor`, `${anterior.cur} → ${agora.cur} (esperava ${anterior.cur + delta})`); ok = false;
      }
      anterior = agora;
    }
    if (ok) console.log(`  ok ${campo.nome}: cada seta anda o cursor e nada mais mexe`);
    if (errosJs.length) dizer(`teclado/${campo.nome}: erro de JS`, errosJs[0]);
    await ctx.close();
  }
  // CONTROLE: SEM campo focado, a seta TEM que agir. Senão o item acima
  // passaria com o teclado morto na app inteira.
  const { ctx, page } = await novaPagina();
  await entrar(page, 'lightbox');
  await page.evaluate(() => document.getElementById('lightboxClose').focus());
  const i0 = await page.evaluate(() => Lightbox.idx);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  const i1 = await page.evaluate(() => Lightbox.idx);
  if (i1 === i0) dizer('controle do teclado: sem campo focado a seta deixou de trocar a foto', `${i0} → ${i1}`);
  else console.log(`  ok controle: sem campo focado a seta age (${i0} → ${i1})`);
  await ctx.close();
}

// ═══ 6. TODA CAMADA TEM VOLTA, e a de baixo continua viva ═════════════════
// "Sem saída" é o defeito que mais custa: a pessoa aperta, não acontece nada,
// aperta de novo e sai da app.
console.log('\n6. VOLTA — Esc fecha a camada de cima e devolve a de baixo funcionando');
// `treino` fica de fora porque NÃO é camada: é um MODO, e sair dele por Esc
// seria uma decisão de produto que ninguém tomou. `filaVazia`/`deslogado`/
// `desfazerCorrendo` idem — nenhum deles é algo que se "fecha".
for (const est of ESTADOS.filter((e) => !['deslogado', 'filaVazia', 'desfazerCorrendo', 'treino'].includes(e.nome))) {
  const { ctx, page, errosJs } = await novaPagina();
  for (const dep of est.requer || []) await entrar(page, dep);
  const entrou = await entrar(page, est.nome);
  if (entrou !== true) { dizer(`volta/${est.nome}: não entrei`); await ctx.close(); continue; }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const aindaAberto = await page.evaluate((expr) => __fx.estado(expr), est.ativo);
  if (aindaAberto === true) dizer(`volta/${est.nome}: Esc não fechou a camada`);
  else {
    // E o card de baixo tem que voltar a responder — camada fechada que deixa a
    // app inerte é o mesmo beco sem saída, só que silencioso.
    const vivo = await page.evaluate(() => {
      const b = document.querySelector('.card-btn-read');
      return !!b && !b.disabled && !b.closest('.hidden');
    });
    if (!vivo && !(est.requer || []).length) dizer(`volta/${est.nome}: fechou, mas o card ficou inerte`);
    else console.log(`  ok ${est.nome}: Esc fecha e devolve o controle`);
  }
  if (errosJs.length) dizer(`volta/${est.nome}: erro de JS`, errosJs[0]);
  await ctx.close();
}


// ═══ 7. A SALA: presença como máquina de estados, do lado do SERVIDOR ══════
//
// Presença é uma máquina de estados PRÓPRIA, e as seções acima não a tocam:
// elas exploram a tela de triagem, num navegador só. A sala vive no servidor e
// só existe com VÁRIAS conexões ao mesmo tempo — nenhum defeito dela cabe numa
// página.
//
// E não é hipotético: o owner relatou que recarregar a página o duplicava na
// lista (e que ele aparecia na PRÓPRIA lista). Nenhuma seção acima veria isso.
//
// Aqui o cliente é o `WebSocket` NATIVO do Node, não um navegador: falo o
// protocolo direto, controlo o tempo, e mando o que um cliente honesto nunca
// mandaria (crachá de outra sala, crachá vencido, socket que nunca se
// identifica). É o que permite cobrar as invariantes de PRIVACIDADE, que são as
// que a Ajuda promete ao editor.
{
  const { makeCrachas } = await import(new URL('../server/core.mjs', import.meta.url));
  const crachas = makeCrachas({ keyBytes: new Uint8Array(Buffer.from(CHAVE_TESTE, 'base64')) });
  const BR = 'row:30';
  const PT = 'row:181';

  // ── Cliente WebSocket escrito À MÃO, e o motivo importa ─────────────────
  //
  // O `WebSocket` global do Node só existe do 22 pra cima. O CI roda no 20 DE
  // PROPÓSITO — o projeto promete Node 18+, e testar no PISO é o que pega uso
  // acidental de API nova. Foi o que aconteceu: escrevi no 22, passou aqui, e o
  // CI reprovou com `WebSocket is not defined`. O CI fez exatamente o trabalho
  // dele.
  //
  // As três saídas erradas: dependência nova (o projeto tem ZERO), navegador
  // (perde o controle do protocolo, que é o ponto desta seção), ou pular o
  // teste no 20 — que seria decoração, verde sem medir nada.
  //
  // Então: cliente próprio, ~60 linhas, do mesmo jeito que `server/ws.mjs` faz
  // o lado servidor. Só o que a sala usa: texto, mascaramento (o RFC exige do
  // CLIENTE) e fechamento.
  function conectar(caminho) {
    return new Promise((k, x) => {
      const chave = randomBytes(16).toString('base64');
      const req = httpRequest({
        hostname: '127.0.0.1', port: PORTA, path: caminho,
        headers: {
          Connection: 'Upgrade', Upgrade: 'websocket',
          'Sec-WebSocket-Key': chave, 'Sec-WebSocket-Version': '13',
        },
      });
      const prazo = setTimeout(() => { req.destroy(); x(new Error('handshake > 5s')); }, 5000);
      req.on('upgrade', (res, socket) => {
        clearTimeout(prazo);
        // Confere o aperto de mão: aceitar qualquer resposta esconderia um
        // servidor que nem é o nosso.
        const esperado = createHash('sha1')
          .update(chave + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        if (res.headers['sec-websocket-accept'] !== esperado) {
          socket.destroy(); x(new Error('Sec-WebSocket-Accept errado')); return;
        }
        socket.setNoDelay(true);
        k(socket);
      });
      req.on('response', (res) => { clearTimeout(prazo); x(new Error('sem upgrade: HTTP ' + res.statusCode)); });
      req.on('error', (e) => { clearTimeout(prazo); x(e); });
      req.end();
    });
  }

  // Quadro de TEXTO do cliente: FIN + opcode 1, e SEMPRE mascarado — o RFC
  // 6455 exige do cliente, e `server/ws.mjs` recusa quadro sem máscara.
  function quadroTexto(txt) {
    const dados = Buffer.from(txt, 'utf8');
    const mascara = randomBytes(4);
    const curto = dados.length < 126;
    const cab = Buffer.alloc(curto ? 2 : 4);
    cab[0] = 0x81;
    if (curto) cab[1] = 0x80 | dados.length;
    else { cab[1] = 0x80 | 126; cab.writeUInt16BE(dados.length, 2); }
    const corpo = Buffer.from(dados);
    for (let i = 0; i < corpo.length; i++) corpo[i] ^= mascara[i & 3];
    return Buffer.concat([cab, mascara, corpo]);
  }

  // Um cliente da sala: conecta, guarda tudo que chega, e sabe esperar.
  async function cliente({ nome, peer, sala = BR, salaDoCracha = sala, entrar = true, idade = 0 }) {
    const socket = await conectar(`/sala?s=${encodeURIComponent(sala)}`);
    const recebidas = [];
    let fechado = null;
    let buf = Buffer.alloc(0);
    socket.on('data', (pedaco) => {
      buf = Buffer.concat([buf, pedaco]);
      // LAÇO, e não um `if`: várias mensagens chegam no MESMO segmento TCP, e
      // tratar só a primeira (ou só a última) já custou tempo neste projeto.
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 0x0f;
        let tam = buf[1] & 0x7f;
        let off = 2;
        if (tam === 126) { if (buf.length < 4) return; tam = buf.readUInt16BE(2); off = 4; }
        else if (tam === 127) { if (buf.length < 10) return; tam = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + tam) return;             // quadro incompleto
        const carga = buf.subarray(off, off + tam);
        buf = buf.subarray(off + tam);
        if (op === 0x8) {                                // fechamento
          fechado = { code: tam >= 2 ? carga.readUInt16BE(0) : 1005,
                      reason: tam > 2 ? carga.subarray(2).toString('utf8') : '' };
          try { socket.end(); } catch { /* já foi */ }
          return;
        }
        if (op === 0x1) { try { recebidas.push(JSON.parse(carga.toString('utf8'))); } catch { /* ruído */ } }
      }
    });
    socket.on('close', () => { if (!fechado) fechado = { code: 1006, reason: '' }; });
    socket.on('error', () => { /* o `close` cobre */ });
    const c = {
      nome, peer, recebidas,
      get fechado() { return fechado; },
      lista: () => [...recebidas].reverse().find((m) => m.t === 'lista') || null,
      sinais: () => recebidas.filter((m) => m.t === 'sinal'),
      manda: (o) => { try { socket.write(quadroTexto(JSON.stringify(o))); } catch { /* morrendo */ } },
      fecha: () => { try { socket.end(); } catch { /* já foi */ } },
    };
    if (entrar) {
      // `idade` em ms permite assinar um crachá VENCIDO sem esperar 15 minutos.
      const cracha = await crachas.assinar({ peer, nome, rank: 5, am: true, staff: false, sala: salaDoCracha },
        Date.now() - idade);
      c.manda({ t: 'entrar', cracha });
    }
    return c;
  }

  const assentar = (ms = 350) => new Promise((k) => setTimeout(k, ms));
  const nomesNaLista = (c) => ((c.lista() || {}).peers || []).map((p) => p.nome);
  const peersNaLista = (c) => ((c.lista() || {}).peers || []).map((p) => p.peer);

  console.log('\n=== 7. A SALA (cliente WebSocket próprio, sem navegador)');

  // ── 7a. CONTROLE: dois editores distintos se veem ───────────────────────
  // Sem isto, TODA invariante abaixo passaria por vácuo: "não vejo ninguém
  // indevido" é trivialmente verdade numa sala que nunca mostra ninguém.
  {
    const ana = await cliente({ nome: 'ana', peer: 'ana1' });
    const bia = await cliente({ nome: 'bia', peer: 'bia1' });
    await assentar();
    if (nomesNaLista(ana).includes('bia') && nomesNaLista(bia).includes('ana')) {
      console.log('  ok controle: dois editores distintos se veem');
    } else {
      dizer('controle da sala: dois editores não se veem — o resto passaria por vácuo',
        `ana vê ${JSON.stringify(nomesNaLista(ana))}, bia vê ${JSON.stringify(nomesNaLista(bia))}`);
    }
    // E ninguém se vê.
    if (nomesNaLista(ana).includes('ana')) dizer('sala: a ana aparece na PRÓPRIA lista');
    if (nomesNaLista(bia).includes('bia')) dizer('sala: a bia aparece na PRÓPRIA lista');
    ana.fecha(); bia.fecha();
    await assentar(250);
  }

  // ── 7b. A MESMA PESSOA EM N CONEXÕES aparece UMA vez ────────────────────
  // O relato do owner. As conexões antigas ficam VIVAS de propósito: depender
  // de elas morrerem sozinhas seria depender de sorte de timing.
  for (const n of [2, 3, 4]) {
    const obs = await cliente({ nome: 'obs', peer: 'obs' + n });
    const abas = [];
    for (let i = 0; i < n; i++) {
      abas.push(await cliente({ nome: 'duda', peer: `duda-aba${i}` }));
      await assentar(150);
    }
    await assentar();
    const vistas = nomesNaLista(obs).filter((x) => x === 'duda').length;
    if (vistas === 1) console.log(`  ok ${n} conexões da mesma pessoa aparecem como 1`);
    else dizer(`sala: ${n} conexões da duda aparecem ${vistas}× pra quem observa`, JSON.stringify(peersNaLista(obs)));
    // A lista tem que apontar pra conexão VIVA — a última. Senão a conversa
    // é chamada num socket morto e o editor fica esperando resposta.
    const ultima = `duda-aba${n - 1}`;
    if (vistas === 1 && !peersNaLista(obs).includes(ultima)) {
      dizer(`sala: a lista aponta pra conexão velha da duda`, JSON.stringify(peersNaLista(obs)));
    }
    // E a própria duda não se vê.
    const ela = abas[abas.length - 1];
    if (nomesNaLista(ela).includes('duda')) dizer('sala: a duda se vê na própria lista');
    // O `total` não pode mentir: é o que a pílula mostra.
    const l = obs.lista();
    if (l && l.total !== l.peers.length) dizer(`sala: o total (${l.total}) não bate com a lista (${l.peers.length})`);
    for (const a of abas) a.fecha();
    obs.fecha();
    await assentar(250);
  }

  // ── 7c. ISOLAMENTO ENTRE SALAS ──────────────────────────────────────────
  // Duas filas são dois lugares. Vazar aqui é mostrar a um editor do Brasil
  // quem está triando Portugal — e, pior, deixar um falar com o outro.
  {
    const br = await cliente({ nome: 'brasileiro', peer: 'br1', sala: BR });
    const pt = await cliente({ nome: 'portugues', peer: 'pt1', sala: PT });
    const br2 = await cliente({ nome: 'brasileiro2', peer: 'br2', sala: BR });
    await assentar();
    // CONTROLE: dentro da MESMA sala eles se veem (senão isto passa por vácuo).
    if (!nomesNaLista(br).includes('brasileiro2')) {
      dizer('controle do isolamento: dois da mesma sala não se veem');
    } else if (nomesNaLista(br).includes('portugues') || nomesNaLista(pt).includes('brasileiro')) {
      dizer('sala: VAZOU entre salas', `br vê ${JSON.stringify(nomesNaLista(br))}, pt vê ${JSON.stringify(nomesNaLista(pt))}`);
    } else {
      console.log('  ok salas isoladas (e o controle prova que a lista funciona)');
    }
    // E a SINALIZAÇÃO não atravessa: mandar pro peer do outro lado não chega.
    br.manda({ t: 'sinal', para: 'pt1', tipo: 'offer', payload: { sdp: 'x' } });
    await assentar(300);
    if (pt.sinais().length) dizer('sala: a sinalização ATRAVESSOU pra outra sala');
    else console.log('  ok a sinalização não atravessa salas');
    br.fecha(); br2.fecha(); pt.fecha();
    await assentar(250);
  }

  // ── 7d. CRACHÁ: de outra sala, vencido, e ausente ───────────────────────
  {
    // Crachá LEGÍTIMO, assinado pra Portugal, usado no socket do Brasil.
    const intruso = await cliente({ nome: 'intruso', peer: 'int1', sala: BR, salaDoCracha: PT });
    await assentar(400);
    if (!intruso.fechado) dizer('sala: crachá de OUTRA sala não foi recusado');
    else console.log(`  ok crachá de outra sala recusado (code ${intruso.fechado.code})`);

    // Crachá VENCIDO (assinado 1h atrás; o TTL é 15min).
    const velho = await cliente({ nome: 'velho', peer: 'vel1', idade: 3600_000 });
    await assentar(400);
    if (!velho.fechado) dizer('sala: crachá VENCIDO não foi recusado');
    else console.log(`  ok crachá vencido recusado (code ${velho.fechado.code})`);

    // Socket ANÔNIMO: conecta e nunca se identifica.
    const anon = await cliente({ nome: 'anon', peer: 'anon1', entrar: false });
    const dono = await cliente({ nome: 'dono', peer: 'dono1' });
    await assentar(400);
    if (anon.lista()) dizer('sala: socket anônimo RECEBEU a lista');
    else console.log('  ok socket anônimo não vê a lista');
    if (nomesNaLista(dono).length) dizer('sala: o anônimo apareceu na lista dos outros', JSON.stringify(nomesNaLista(dono)));
    else console.log('  ok o anônimo não aparece na lista de ninguém');
    // E ele não consegue falar com quem está lá.
    anon.manda({ t: 'sinal', para: 'dono1', tipo: 'offer', payload: { sdp: 'x' } });
    await assentar(300);
    if (dono.sinais().length) dizer('sala: o anônimo conseguiu SINALIZAR');
    else console.log('  ok o anônimo não consegue sinalizar');
    intruso.fecha(); velho.fecha(); anon.fecha(); dono.fecha();
    await assentar(250);
  }

  // ── 7e. A SINALIZAÇÃO É 1:1, nunca difusão ──────────────────────────────
  // O aperto de mão do WebRTC carrega o endereço de rede dos dois lados. Se
  // ele fosse difundido, entrar numa sala revelaria o IP de todo mundo.
  {
    const a = await cliente({ nome: 'a', peer: 'pa' });
    const b = await cliente({ nome: 'b', peer: 'pb' });
    const c = await cliente({ nome: 'c', peer: 'pc' });
    await assentar();
    a.manda({ t: 'sinal', para: 'pb', tipo: 'offer', payload: { sdp: 'segredo' } });
    await assentar(400);
    if (b.sinais().length !== 1) dizer(`sala: o destinatário recebeu ${b.sinais().length} sinais (esperava 1)`);
    else console.log('  ok o sinal chega ao destinatário');
    if (c.sinais().length) dizer('sala: o sinal VAZOU pra quem não era destinatário', JSON.stringify(c.sinais()));
    else console.log('  ok o sinal NÃO vaza pra terceiros');
    if (a.sinais().length) dizer('sala: o remetente recebeu o próprio sinal de volta');
    a.fecha(); b.fecha(); c.fecha();
    await assentar(250);
  }

  // ── 7f. SAIR REMOVE DA LISTA DE TODOS, sem prazo ────────────────────────
  // A Ajuda promete "some assim que você sai", nas 4 línguas. Se isto falhar,
  // a app mente — e ninguém consegue depurar uma promessa de texto.
  {
    const fica = await cliente({ nome: 'fica', peer: 'f1' });
    const vai = await cliente({ nome: 'vai', peer: 'v1' });
    await assentar();
    if (!nomesNaLista(fica).includes('vai')) dizer('controle da saída: os dois não se viram antes');
    vai.fecha();
    await assentar(600);
    if (nomesNaLista(fica).includes('vai')) dizer('sala: quem saiu continua na lista');
    else console.log('  ok quem sai some da lista de todos, sem prazo');
    fica.fecha();
    await assentar(250);
  }

  // ── 7g. O TEXTO DA CONVERSA NUNCA PASSA PELO SERVIDOR ────────────────────
  // A Ajuda promete que a mensagem vai direto entre os aparelhos. O servidor
  // só transporta o APERTO DE MÃO, e nada mais: se um `tipo` desconhecido
  // fosse repassado, ele viraria um canal de texto pelo servidor sem ninguém
  // ter decidido isso.
  {
    const a = await cliente({ nome: 'a', peer: 'ta' });
    const b = await cliente({ nome: 'b', peer: 'tb' });
    await assentar();
    a.manda({ t: 'sinal', para: 'tb', tipo: 'offer', payload: { sdp: 'ok' } });
    await assentar(300);
    const antes = b.sinais().length;
    // Uma "mensagem" disfarçada de sinal.
    a.manda({ t: 'mensagem', para: 'tb', texto: 'isto não pode chegar pelo servidor' });
    a.manda({ t: 'texto', para: 'tb', texto: 'nem isto' });
    await assentar(400);
    const tudo = JSON.stringify(b.recebidas);
    if (/isto não pode chegar|nem isto/.test(tudo)) dizer('sala: o servidor repassou TEXTO de conversa');
    else console.log(`  ok o servidor não repassa texto (só o aperto de mão: ${antes} sinal)`);
    a.fecha(); b.fecha();
    await assentar(250);
  }
}

await browser.close();
servidor.kill();

if (falhas) {
  console.log(`\n✗ smoke de fluxo: ${falhas} falha(s)`);
  process.exit(1);
}
console.log(`\n✓ smoke de fluxo: ${ESTADOS.length} estados, ${ESCRITA.length} ações de escrita`
  + `, ${pares} pares medidos × ${ACOES_NEUTRAS.length} ações neutras depois de entrar`
  + `, + rede (clique E tecla, com controle dos dois lados)`
  + `, + teclado em ${2} campos com controle, + volta por Esc em toda camada`
  + `, + A SALA em cliente WebSocket próprio (RFC 6455, roda no piso Node 18): 2-4 conexões da mesma pessoa, isolamento entre salas,`
  + ` crachá de outra sala/vencido/ausente, sinal 1:1 sem vazar, saída sem prazo, e o servidor sem repassar texto`);
