// Smoke de browser — o que os guards de texto NÃO pegam.
//
// Os testes de `test/layout.test.mjs` conferem o CÓDIGO (classe presente,
// seletor com especificidade certa). Isso já falhou duas vezes em silêncio:
// uma porque o guard não olhava `display`, outra porque lia só o primeiro bloco
// `@media`. O que prova mesmo é renderizar e MEDIR — foi assim que apareceram o
// rótulo transbordando a célula, o toast cobrindo o próprio alvo e a rolagem
// dupla dentro do card.
//
// Mora em `tools/`, NÃO em `test/`, de propósito: o `node --test` varre o
// diretório test/ inteiro, e este script precisa de servidor + browser. Dentro
// de test/ ele entraria no `npm test` e quebraria a promessa central do projeto
// — rodar a suíte com ZERO dependência. (Aconteceu: apareceu como "ok 8".)
//
//   npm run test:browser
//
// Playwright é resolvido de três lugares, nesta ordem: node_modules local (é
// como o CI instala, com --no-save), o global do sandbox de desenvolvimento, e
// o import nu. Sem nenhum deles o script FALHA — nunca passa calado, porque
// teste que se auto-pula vira teste que ninguém percebe que morreu.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.SMOKE_PORT || 8123);
const BASE = `http://127.0.0.1:${PORTA}/`;

async function carregarPlaywright() {
  const req = createRequire(import.meta.url);
  const tentativas = [
    () => req.resolve('playwright', { paths: [ROOT] }),
    () => '/opt/node22/lib/node_modules/playwright/index.mjs',
    () => 'playwright',
  ];
  const erros = [];
  for (const t of tentativas) {
    let mod;
    try {
      mod = await import(t());
    } catch (e) {
      erros.push(String(e.message || e).split('\n')[0]);
      continue;
    }
    // O pacote publicado é CJS (`index.js`): `import()` devolve namespace só com
    // `default`, e `mod.chromium` vem undefined. O `index.mjs` do global do
    // sandbox tem exports nomeados — por isso funcionava aqui e quebrou no CI
    // com "Cannot read properties of undefined (reading 'launch')". Aceitar as
    // duas formas, e só aceitar candidato que realmente tenha o `chromium`.
    const pw = mod && mod.chromium ? mod : (mod && mod.default) || {};
    if (pw.chromium) return pw;
    erros.push(`${t()}: importou, mas sem export 'chromium' (chaves: ${Object.keys(mod).join(', ')})`);
  }
  console.error('✗ Playwright não encontrado. Tentativas:\n  - ' + erros.join('\n  - '));
  console.error('  No CI: npm i --no-save playwright@1.49.1 (com PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1)');
  process.exit(1);
}

// No runner do GitHub o Chrome já vem instalado — usar o canal evita baixar
// ~150MB de Chromium a cada run. No sandbox de dev usamos o Chromium do
// PLAYWRIGHT_BROWSERS_PATH. Se nenhum abrir, o erro sobe (não silencia).
async function abrirBrowser(chromium) {
  const erros = [];
  for (const opcoes of [{}, { channel: 'chrome' }, { channel: 'chromium' }]) {
    try {
      return await chromium.launch(opcoes);
    } catch (e) {
      erros.push(`${JSON.stringify(opcoes)}: ${String(e.message || e).split('\n')[0]}`);
    }
  }
  throw new Error('nenhum browser abriu:\n  - ' + erros.join('\n  - '));
}

const foto = 'data:image/svg+xml;base64,' + Buffer.from(
  "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='400'><rect width='800' height='400' fill='#334155'/></svg>",
).toString('base64');

// Um card de cada forma: o de atualização (caixa de mudanças), o de reporte
// (caixa de texto) e o de foto nova (sem caixa longa).
const CARDS = {
  UPDATE: {
    venueID: 'v1', updateRequestID: 'u1', name: 'Restaurante e Choperia do Seu Zé Grelhados na Brasa',
    categories: ['RESTAURANT', 'BAR', 'FAST_FOOD'],
    address: 'Rodovia Governador Mário Covas, km 232,5, s/n, Distrito Industrial, São José do Rio Preto - São Paulo',
    updateType: 'Atualização: Nome', updateTypeKey: 'UPDATE', reqType: 'REQUEST', reqSubType: 'UPDATE',
    createdBy: 'UsuarioComNomeLongoParaTestar', imageUrls: [foto], brand: null,
    changes: [
      { field: 'name', label: 'Nome', from: 'Zé', to: 'Restaurante do Seu Zé' },
      { field: 'phone', label: 'Telefone', from: null, to: '(17) 99999-9999' },
      { field: 'residential', label: 'Residencial', from: true, to: false },
      { field: 'streetID', label: 'Rua', from: '', to: 'Av. Alberto Andaló' },
      { field: 'campoNovoDoWaze', label: 'CampoNovoDoWaze', from: 'a', to: 'b' },
    ],
    dateAdded: 1785203731191, lat: -20.8, lon: -49.4,
  },
  FLAG: {
    venueID: 'v2', updateRequestID: 'u2', name: 'Loja Fechada Faz Tempo',
    categories: ['SHOPPING_AND_SERVICES'], address: 'Rua Bernardino de Campos, 3000 - Centro',
    updateType: 'Reporte (Sinalização)', updateTypeKey: 'FLAG', reqType: 'REQUEST', reqSubType: 'FLAG',
    createdBy: 'mariazinha', imageUrls: [foto, foto], brand: null, changes: [],
    flagType: 'INAPPROPRIATE', flagSubjectType: 'IMAGE', flagEntityID: null,
    flagComment: 'Esse lugar fechou faz mais de um ano, hoje é uma oficina mecânica. Passei lá ontem e confirmei com o dono do imóvel, que disse que a loja saiu em 2024. O ponto está errado no mapa e atrapalha quem procura.',
    dateAdded: 1785203731191, lat: -20.8, lon: -49.4,
  },
  // Pedido de alteração cujos campos vieram TODOS iguais ao valor atual. O
  // `changedVenue` do Waze não é um diff — é o local inteiro — então isso
  // acontece de verdade (medido: 2 pedidos numa fila de 98). O card não pode
  // ficar mudo nem inventar: diz que comparou e não há o que alterar.
  SEM_DIFERENCA: {
    venueID: 'v5', updateRequestID: 'u5', name: 'Brickell Avenue',
    categories: ['OTHER'], address: 'Av. das Nações Unidas, 12901 - São Paulo',
    updateType: 'Atualização (detalhes)', updateTypeKey: 'UPDATE_DETAILS',
    reqType: 'REQUEST', reqSubType: 'UPDATE',
    createdBy: 'usuarioqualquer', imageUrls: [foto], brand: null,
    changes: [], camposSemMudanca: 1,
    dateAdded: 1785203731191, lat: -23.6, lon: -46.7,
  },
  // Campo que é OBJETO simples (não lista): mostra só as folhas que mudaram, em
  // vez do JSON inteiro. O caminho vai cru e uma das folhas é ela própria uma
  // lista — o pior caso de largura da caixa, e é de propósito.
  OBJ_DIFF: {
    venueID: 'v6', updateRequestID: 'u6', name: 'Eletroposto Porsche Salvador Shopping',
    categories: ['CHARGING_STATION'], address: 'R. Prof. Magalhães Neto, 1752 - Salvador',
    updateType: 'Atualização: Atributos da categoria', updateTypeKey: 'UPDATE',
    reqType: 'REQUEST', reqSubType: 'UPDATE',
    createdBy: 'eco_movement', imageUrls: [foto], brand: null, camposSemMudanca: 0,
    changes: [
      // Item de lista VAZIO. O Waze manda isso: medido na fila real, um pedido
      // do "Posto Equador" propunha `services: [""]`. O card mostrava `+` e
      // mais nada, que lê como app quebrada. Vira `(vazio)` com
      // `.valor-ausente`, e é aqui que o smoke mede o contraste dele DENTRO do
      // verde do `.diff-add` — o 0.8 de opacidade foi medido sobre branco, não
      // sobre verde.
      { field: 'services', label: 'Serviços', from: null, to: [''],
        delta: { add: [''], del: [] } },
      { field: 'categoryAttributes', label: 'CategoryAttributes', from: '[objeto]', to: '[objeto]',
        objDelta: [
          { caminho: 'CHARGING_STATION.source', de: 'ECO_MOVEMENT', para: 'WME' },
          { caminho: 'CHARGING_STATION.network', de: 'Porsche Smart Mobility GmbH', para: 'Ponto de Carga' },
          // Folha que é LISTA: o core manda o delta pronto (o que entrou / o
          // que saiu), e o card usa o mesmo +/− do campo de lista de topo.
          // Dois removidos e um adicionado é o caso REAL medido — e é também o
          // pior de altura, que é o recurso escasso do card.
          { caminho: 'CHARGING_STATION.chargingPorts',
            de: [{ portId: '1', connectorTypes: ['TYPE2'], maxChargeSpeedKw: 11, count: 1 },
                 { portId: '39133723', connectorTypes: ['TYPE2'], maxChargeSpeedKw: 11, count: 1 }],
            para: [{ portId: 'TYPE2.11', connectorTypes: ['TYPE2'], maxChargeSpeedKw: 11, count: 2 }],
            delta: {
              add: [{ portId: 'TYPE2.11', connectorTypes: ['TYPE2'], maxChargeSpeedKw: 11, count: 2 }],
              del: [{ portId: '1', connectorTypes: ['TYPE2'], maxChargeSpeedKw: 11, count: 1 },
                    { portId: '39133723', connectorTypes: ['TYPE2'], maxChargeSpeedKw: 11, count: 1 }],
            } },
        ] },
    ],
    dateAdded: 1785203731191, lat: -12.97, lon: -38.45,
  },
  // Sem nome nem criador: exercita a cadeia de identidade e TODOS os
  // placeholders de uma vez (é o card que mede contraste do esmaecido).
  SEM_NOME: {
    venueID: 'v4', updateRequestID: 'u4', name: null, categories: [],
    address: 'Av. Paraíso, 224, Campo Novo do Parecis - Mato Grosso',
    updateType: 'Novo Local', updateTypeKey: 'VENUE', reqType: 'VENUE', reqSubType: '',
    createdBy: null, imageUrls: [foto], brand: null, changes: [],
    dateAdded: 1785203731191, lat: -14, lon: -57,
  },
  IMAGE: {
    venueID: 'v3', updateRequestID: 'u3', name: 'Padaria Pão Quente',
    categories: ['BAKERY'], address: 'Rua XV de Novembro, 100 - Centro',
    updateType: 'Nova Foto', updateTypeKey: 'IMAGE', reqType: 'IMAGE', reqSubType: '',
    createdBy: 'joaozinho', imageUrls: [foto, foto], brand: null, changes: [],
    dateAdded: 1785203731191, lat: -20.8, lon: -49.4,
  },
};

const APARELHOS = [
  ['Pixel 7', { width: 412, height: 915 }],
  ['iPhone SE', { width: 375, height: 667 }],
  ['laptop 1280x800', { width: 1280, height: 800 }],
  // Os dois que mais apertam a conta de altura, e onde a barra ✕/↑/✓ nascia
  // abaixo da dobra: o estreito (placar vira 2×2 e o custo fixo pula pra 219px)
  // e o deitado (393px de altura pra app inteira).
  ['Galaxy Fold', { width: 280, height: 653 }],
  ['paisagem 852x393', { width: 852, height: 393 }],
];
const LINGUAS = ['pt', 'en', 'es', 'fr'];

let falhas = 0;
const checa = (ok, msg, detalhe) => {
  if (!ok) { falhas++; console.log(`  ✗ ${msg}${detalhe ? ' — ' + detalhe : ''}`); }
};

const servidor = spawn(process.execPath, [join(ROOT, 'server', 'node.mjs')], {
  env: { ...process.env, PORT: String(PORTA), HOST: '127.0.0.1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
process.on('exit', () => servidor.kill());

async function esperarServidor() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`servidor não subiu em ${BASE}`);
}

const { chromium } = await carregarPlaywright();
await esperarServidor();
const browser = await abrirBrowser(chromium);

for (const [aparelho, viewport] of APARELHOS) {
  // Dois temas: o esmaecido mistura com o fundo, então o contraste é OUTRO em
  // cada um (medido: 5.74:1 no claro contra 8.15:1 no escuro).
  const tema = APARELHOS.indexOf(APARELHOS.find(([n]) => n === aparelho)) % 2 ? 'dark' : 'light';
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', locale: 'pt-BR', colorScheme: tema });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);

  for (const lang of LINGUAS) {
    for (const [tipo, place] of Object.entries(CARDS)) {
      await page.evaluate(({ pl, lang: l }) => {
        setLang(l);
        AppState.authenticated = true;
        AppState.profile = { id: 1, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false };
        AppState.stats = { read: 12, rejected: 3, skipped: 1 };
        AppState.serverTotal = 40;
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.remove('hidden');
        renderProfileHeader(AppState.profile);
        updateStats();
        showLoading(false);
        document.getElementById('noMoreCards').classList.add('hidden');
        AppState.queue = [pl];
        AppState.currentPlace = pl;
        showCurrentPlace();
      }, { pl: place, lang });
      await page.waitForTimeout(350);

      const m = await page.evaluate(() => {
        const c = document.querySelector('.place-card');
        if (!c) return null;
        const rola = (sel) => {
          const e = c.querySelector(sel);
          if (!e || !e.offsetParent) return null;
          return e.scrollHeight > e.clientHeight + 1;
        };
        // A barra ✕/↑/✓ está NA TELA e recebe o toque? É a ação principal da
        // app: fora da dobra ela é inalcançável, porque o card tem
        // `touch-action: none` (arrastar pra cima é "pular") e a página só rola
        // agarrando a margem. Medir contra a VIEWPORT, não contra o contêiner.
        const acoes = c.querySelector('.card-actions');
        const ar = acoes ? acoes.getBoundingClientRect() : null;
        const acoesFora = ar ? Math.max(0, Math.round(ar.bottom - innerHeight), Math.round(-ar.top)) : 0;
        const botoesBloqueados = [];
        for (const cls of ['card-btn-reject', 'card-btn-skip', 'card-btn-read']) {
          const b = c.querySelector('.' + cls);
          if (!b) continue;
          const r = b.getBoundingClientRect();
          const no = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
          if (!no || !no.closest('.' + cls)) botoesBloqueados.push(cls.replace('card-btn-', ''));
          if (Math.min(r.width, r.height) < 44) botoesBloqueados.push(`${cls.replace('card-btn-', '')} ${Math.round(Math.min(r.width, r.height))}px`);
        }
        const paginaRola = document.documentElement.scrollHeight - innerHeight;
        const cont = c.querySelector('.card-content');
        const areas = [];
        if (cont.scrollHeight > cont.clientHeight + 1) areas.push('card-content');
        if (rola('.card-changes-list')) areas.push('card-changes-list');
        if (rola('.card-flag-comment-text')) areas.push('card-flag-comment-text');
        const visivel = (sel) => {
          const e = c.querySelector(sel);
          return !!e && !!e.offsetParent && (e.textContent || '').trim() !== '';
        };
        const roláveisSemNome = [...c.querySelectorAll('.card-changes-list, .card-flag-comment-text')]
          .filter((e) => !e.getAttribute('aria-label')).length;
        // Teto FIXO na caixa longa é a volta do bug antigo — e ele não estoura
        // nada (capar deixa o conteúdo MENOR), então só se pega olhando o
        // estilo computado: a caixa tem que ser dimensionada pelo flex.
        const comTetoFixo = [...c.querySelectorAll('.card-changes-list, .card-flag-comment-text')]
          .filter((e) => e.offsetParent && getComputedStyle(e).maxHeight !== 'none')
          .map((e) => `${[...e.classList][0]}=${getComputedStyle(e).maxHeight}`);
        // Contraste do que a app esmaece. `opacity` MISTURA a cor com o fundo,
        // e getComputedStyle().color não conta isso — só medindo aparece. Já
        // reprovou: o esmaecido nasceu em 0.65 e deu 3.79:1 no tema claro.
        const rgb = (v) => (v.match(/[\d.]+/g) || []).map(Number);
        const fundoDe = (el) => {
          for (let n = el; n; n = n.parentElement) {
            const cor = rgb(getComputedStyle(n).backgroundColor);
            if (cor.length >= 3 && (cor[3] === undefined || cor[3] > 0.9)) return cor.slice(0, 3);
          }
          return [255, 255, 255];
        };
        const lum = ([r, g, b]) => {
          const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const contrasteBaixo = [];
        for (const e of c.querySelectorAll('.valor-ausente, .card-no-name-badge')) {
          if (!e.offsetParent || !(e.textContent || '').trim()) continue;
          const cs = getComputedStyle(e);
          let o = 1;
          for (let n = e; n && n !== document.documentElement; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity) || 1;
          const fundo = fundoDe(e);
          const efetiva = rgb(cs.color).slice(0, 3).map((v, i) => v * o + fundo[i] * (1 - o));
          const [x, y] = [lum(efetiva), lum(fundo)].sort((m, n) => n - m);
          const razao = (x + 0.05) / (y + 0.05);
          const px = parseFloat(cs.fontSize);
          const minimo = (px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight, 10) >= 700)) ? 3 : 4.5;
          if (razao < minimo) contrasteBaixo.push(`${[...e.classList][0]} ${razao.toFixed(2)}:1 < ${minimo}`);
        }
        return {
          areas,
          acoesFora, botoesBloqueados, paginaRola,
          nome: (c.querySelector('.card-name').textContent || '').trim(),
          tipo: (c.querySelector('.card-type').textContent || '').trim(),
          temAcoes: !!c.querySelector('.card-btn-reject') && !!c.querySelector('.card-btn-skip') && !!c.querySelector('.card-btn-read'),
          botoesVisiveis: [...c.querySelectorAll('.card-actions button')].every((b) => b.getBoundingClientRect().height >= 44),
          diffs: c.querySelectorAll('.diff-row').length,
          roláveisSemNome, comTetoFixo, contrasteBaixo,
          // O endereço tem que estar EM ALGUM LUGAR: na linha própria, ou como
          // título quando o local não tem nome (aí a linha some de propósito,
          // pra não repetir). Checar só a linha reprovava o card sem nome.
          endereco: visivel('.card-address') || c.querySelector('.card-name.titulo-endereco') !== null,
          semNome: !!c.querySelector('.card-no-name-badge:not(.hidden)'),
          estouroH: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });

      const rot = `${aparelho} · ${lang} · ${tipo}`;
      if (!m) { checa(false, `${rot}: card não renderizou`); continue; }

      // O card inteiro NUNCA pode rolar: rolar ali mata o gesto de "pular".
      checa(!m.areas.includes('card-content'), `${rot}: o card inteiro voltou a rolar`, m.areas.join('+'));
      // E só UMA área pode rolar por vez.
      checa(m.areas.length <= 1, `${rot}: mais de uma área rolando`, m.areas.join('+'));
      // Os três botões de ação existem e respeitam o alvo de toque.
      checa(m.temAcoes, `${rot}: sumiu botão de ação`);
      checa(m.botoesVisiveis, `${rot}: botão de ação abaixo de 44px`);
      // Nada de informação essencial em branco.
      checa(m.nome !== '', `${rot}: card sem nome`);
      checa(m.tipo !== '', `${rot}: card sem tipo`);
      checa(m.endereco, `${rot}: card sem endereço (nem na linha, nem no título)`);
      // Sem nome → selo visível. Com nome → selo escondido. Nunca os dois errados.
      checa(m.semNome === (tipo === 'SEM_NOME'), `${rot}: selo de "sem nome" no estado errado`, `selo=${m.semNome}`);
      // A página não pode estourar na horizontal.
      checa(m.estouroH <= 0, `${rot}: estouro horizontal de ${m.estouroH}px`);
      // Área que rola precisa de nome (leitor de tela).
      checa(m.roláveisSemNome === 0, `${rot}: ${m.roláveisSemNome} área(s) rolável(is) sem aria-label`);
      checa(m.comTetoFixo.length === 0, `${rot}: caixa longa com teto fixo em vez de flex`, m.comTetoFixo.join(', '));
      checa(m.contrasteBaixo.length === 0, `${rot}: texto esmaecido abaixo do contraste do WCAG`, m.contrasteBaixo.join(', '));
      // A app cabe na tela: card dimensionado pela SOBRA, não por fração da
      // janela. Sem isso a barra de ações nasce abaixo da dobra (medido: 87px
      // no Fold, 92px deitado, 17px no iPhone SE).
      checa(m.acoesFora === 0, `${rot}: barra ✕/↑/✓ fora da tela`, `${m.acoesFora}px`);
      checa(m.botoesBloqueados.length === 0, `${rot}: botão da barra inalcançável ou pequeno demais`, m.botoesBloqueados.join(', '));
      checa(m.paginaRola <= 0, `${rot}: a página rola — rolagem disputa com o gesto de "pular"`, `${m.paginaRola}px`);
      // Mudanças: TODAS aparecem, sem cap.
      if (tipo === 'UPDATE') {
        checa(m.diffs === CARDS.UPDATE.changes.length,
          `${rot}: mostrou ${m.diffs} de ${CARDS.UPDATE.changes.length} mudanças`);
      }
      // Nada de português vazando fora do pt.
      if (lang !== 'pt') {
        const pt = /\b(Atualização|Novo Local|Nova Foto|Reporte|Pedido de remoção|Tipo desconhecido)\b/;
        checa(!pt.test(m.tipo), `${rot}: tipo em português`, m.tipo);
      }
    }
  }
  checa(erros.length === 0, `${aparelho}: erro de JS na página`, erros[0]);
  await ctx.close();
}

// ── Convite de instalar: cabe na TELA, não só no painel ───────────────────
// O #noMoreCards é `absolute inset-0` do #cardStack, que já nasce mais alto que
// a janela em tela curta. Medir contenção contra o painel aprova o que o
// screenshot mostra cortado (foi o que aconteceu): o que vale é a viewport.
// Aparelhos apertados de propósito — Fold (estreito faz cada linha virar três)
// e deitado, onde sobram ~240px de painel visível. Nas três línguas, porque a
// string mais larga decide o layout e ela quase nunca é a do idioma em que se
// desenvolve (gotcha #25).
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
for (const [nome, vp, iOS] of [
  ['Galaxy Fold', { width: 280, height: 653 }, false],
  ['iPhone deitado', { width: 852, height: 393 }, true],
  ['iPhone SE', { width: 375, height: 667 }, true],
]) {
  const ctx = await browser.newContext({ viewport: vp, serviceWorkers: 'block', locale: 'pt-BR',
    isMobile: vp.width < 900, hasTouch: true, userAgent: iOS ? UA_IPHONE : undefined });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  for (const lang of LINGUAS) {
    const m = await page.evaluate(({ lang, iOS }) => {
      aplicarIdioma(lang);
      AppState.authenticated = true;
      AppState.profile = { id: 1, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false };
      AppState.stats = { read: 3, rejected: 1, skipped: 0 };
      AppState.serverTotal = 0;
      document.getElementById('authScreen').classList.add('hidden');
      document.getElementById('appScreen').classList.remove('hidden');
      renderProfileHeader(AppState.profile); updateStats(); showLoading(false);
      // O Chromium não dispara `beforeinstallprompt` sozinho; no iOS ele nunca
      // dispara mesmo — é o caso dos passos manuais.
      if (!iOS) {
        window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'),
          { prompt: () => {}, userChoice: Promise.resolve({ outcome: 'accepted' }) }));
      }
      AppState.queue = []; AppState.currentPlace = null;
      showNoPlaces();
      const box = document.getElementById('installInvite');
      if (!box || box.classList.contains('hidden')) return { ausente: true };
      const fora = [];
      // O que PRECISA estar na tela: a ação (botão ou passos) e a saída.
      for (const id of ['installInviteBtn', 'installIosSteps', 'installDismissBtn']) {
        const e = document.getElementById(id);
        if (!e || e.classList.contains('hidden')) continue;
        const r = e.getBoundingClientRect();
        if (r.bottom > innerHeight + 1 || r.top < 0) fora.push(`${id} ${Math.round(r.bottom - innerHeight)}px`);
      }
      const dis = document.getElementById('installDismissBtn').getBoundingClientRect();
      return { fora, alvoDispensar: Math.round(Math.min(dis.width, dis.height)) };
    }, { lang, iOS });
    const rot = `convite · ${nome} · ${lang}`;
    checa(!m.ausente, `${rot}: convite não apareceu`);
    if (m.ausente) continue;
    checa(m.fora.length === 0, `${rot}: parte do convite fora da tela`, m.fora.join(', '));
    checa(m.alvoDispensar >= 44, `${rot}: "Agora não" abaixo de 44px`, `${m.alvoDispensar}px`);
  }
  await ctx.close();
}

// ── Laço de ResizeObserver com barra de rolagem que OCUPA ESPAÇO ────────────
// O editor relatou um toast VERMELHO "Erro inesperado: ResizeObserver loop
// completed with undelivered notifications" ao abrir a foto, no laptop.
//
// A causa era a vigia do estouro escrever no DOM de dentro do callback do
// observer: ligar `.card-content-rola` muda o `overflow-y`, e onde a barra é
// CLÁSSICA ela ocupa largura — encolhendo o content box que o próprio observer
// observa. Re-entrada no mesmo quadro → o browser reclama.
//
// Este Chromium só tem barra SOBREPOSTA (medido: `overflow-y: scroll` dá 0px de
// barra), e por isso o bug não aparecia em nenhum teste automatizado. A única
// propriedade que ocupa largura aqui é `scrollbar-gutter: stable` — é ela que
// emula fielmente o laptop. Vai numa passada SEPARADA de propósito: injetar
// isso na matriz principal mudaria as larguras e falsearia as outras medidas.
{
  const ctx = await browser.newContext({ viewport: { width: 445, height: 620 },
    serviceWorkers: 'block', locale: 'pt-BR', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const laco = [];
  // O erro chega por window.onerror, NÃO por pageerror — a app o intercepta e
  // registra no console. Qualquer ocorrência significa que o laço voltou.
  page.on('console', (m) => { if (/ResizeObserver loop/i.test(m.text())) laco.push(m.text().slice(0, 80)); });
  page.on('pageerror', (e) => { if (/ResizeObserver loop/i.test(String(e))) laco.push(String(e).slice(0, 80)); });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: '.card-content.card-content-rola { scrollbar-gutter: stable; }' });
  await page.waitForTimeout(300);

  for (const [tipo, place] of Object.entries(CARDS)) {
    await page.evaluate((pl) => {
      aplicarIdioma('pt');
      AppState.authenticated = true;
      AppState.profile = { id: 1, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false };
      AppState.stats = { read: 12, rejected: 3, skipped: 1 };
      AppState.serverTotal = 40;
      document.getElementById('authScreen').classList.add('hidden');
      document.getElementById('appScreen').classList.remove('hidden');
      document.getElementById('noMoreCards').classList.add('hidden');
      renderProfileHeader(AppState.profile); updateStats(); showLoading(false);
      AppState.queue = [pl]; AppState.currentPlace = pl;
      document.querySelectorAll('.place-card').forEach((e) => e.remove());
      showCurrentPlace(); updatePendingCount();
    }, place);
    await page.waitForTimeout(500);
    // O laço só nasce quando a classe TROCA de estado com o observer já ativo —
    // renderizar num tamanho fixo não basta, porque aí ela já nasce decidida.
    // (Primeira versão deste teste passava com o defeito reintroduzido de
    // propósito: guard que não guarda. Encolher a janela é o que força a troca,
    // e é também o caso real de girar o aparelho.)
    await page.setViewportSize({ width: 445, height: 470 });
    await page.waitForTimeout(400);
    await page.setViewportSize({ width: 445, height: 620 });
    await page.waitForTimeout(400);
    // O gesto do relato: abrir a foto. O lightbox trava a rolagem da página, o
    // que muda a largura e faz o observer disparar.
    await page.click('.card-image').catch(() => {});
    await page.waitForTimeout(300);
    await page.evaluate(() => { try { Lightbox.close(); } catch {} });
    await page.waitForTimeout(300);
    // O toast é o que o editor VÊ — e um erro não-acionável do browser não pode
    // aparecer em cima do card de quem está triando.
    const toast = await page.evaluate(() => [...document.querySelectorAll('#notifyStack .toast')]
      .map((t) => t.textContent.trim()).find((t) => /Erro inesperado/.test(t)) || null);
    checa(!toast, `laço RO · ${tipo}: toast de erro na cara do editor`, toast);
  }
  checa(laco.length === 0, 'laço de ResizeObserver voltou (barra que ocupa espaço)', laco[0]);
  await ctx.close();
}

await browser.close();
servidor.kill();

if (falhas) {
  console.log(`\n✗ smoke de browser: ${falhas} falha(s)`);
  process.exit(1);
}
console.log(`✓ smoke de browser: ${APARELHOS.length} aparelhos × ${LINGUAS.length} idiomas × ${Object.keys(CARDS).length} tipos de card, + convite de instalar em 3 telas apertadas × ${LINGUAS.length} idiomas`);
