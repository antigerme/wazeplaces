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
import { readFileSync } from 'node:fs';
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

// RETRATO, não paisagem — e a diferença não é estética.
//
// A base do flex da foto era `auto`, resolvida pelo tamanho INTRÍNSECO da
// <img>: a proporção da imagem decidia quanto de altura sobrava pro texto.
// Medido com 51 pedidos reais de 6 países num Galaxy Fold: 800×400 → 0 cards
// estouram; 512×512 → 20; 1080×1920 → 31. Esta fixture era 800×400, ou seja,
// **o único formato que nunca falha** — a fixture escondia exatamente o
// defeito que ela existe pra encontrar, em todo tipo de card e todo país.
//
// Foto de pedido é tirada de CELULAR, então retrato é o caso comum, não o
// extremo. A base do flex virou 0 (o layout não depende mais da imagem), e a
// fixture ficou retrato pra o smoke medir o caso real se alguém reverter.
const SVG_CINZA = "<svg xmlns='http://www.w3.org/2000/svg' width='1080' height='1920'><rect width='1080' height='1920' fill='#334155'/></svg>";
const foto = 'data:image/svg+xml;base64,' + Buffer.from(SVG_CINZA).toString('base64');

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
    // CLOSED: 13 ocorrências na fila real, e a redação vem do próprio WME. Era
    // INAPPROPRIATE, que ocorre 1 vez.
    //
    // O resíduo que este comentário registrava — motivo de duas linhas +
    // comentário longo estourando no Fold — MORREU: o motivo saiu de dentro da
    // caixa rosa e as linhas de categoria/endereço adotaram o padrão compacto.
    // Medido depois: 117 pedidos reais × 4 aparelhos × 4 idiomas = 1872 renders,
    // zero estouro (eram 156). O caso seco virou a fixture FLAG_SECO.
    flagType: 'CLOSED', flagSubjectType: 'IMAGE', flagEntityID: null,
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
      // Serviços TRADUZIDOS (dicionário do Transifex do Waze), com os três mais
      // longos do pt: se a linha estourar, é aqui que aparece. Categoria fica de
      // fora de propósito — ela sai crua por decisão do owner.
      { field: 'services', label: 'Serviços', from: null,
        to: ['RESTROOMS', 'PARKING_FOR_CUSTOMERS', 'WHEELCHAIR_ACCESSIBLE'],
        delta: { add: ['PARKING_FOR_CUSTOMERS', 'WHEELCHAIR_ACCESSIBLE'], del: ['RESTROOMS'] } },
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
  // Reporte SEM comentário — que é a maioria: 15 de 17 na fila real do owner.
  // Este era o pior caso medido e falhava em 8 de 8 ocorrências: motivo de duas
  // linhas (`DOES_NOT_MATCH_SEARCH`), endereço de três, duas categorias e linha
  // de marca. Antes, o motivo morava dentro da caixa rosa, então com o
  // comentário vazio sobrava ~40px de moldura (borda + padding + cabeçalho)
  // pra exibir uma linha — e o card inteiro passava a rolar, o que desliga o
  // gesto de pular (gotcha #29).
  //
  // Os valores vieram de pedidos REAIS (fila de 2026-08-04). Fixture inventada
  // mede o que eu imaginei; foi dado real que achou este caso, depois de a
  // auditoria de fixture ter passado.
  FLAG_SECO: {
    venueID: 'v6', updateRequestID: 'u6', name: 'Velório São Vicente de Paulo',
    categories: ['BUS_STATION', 'SHOPPING_CENTER'],
    address: 'Av. Manoel Carneiro de Menezes, Nova Friburgo - Rio de Janeiro',
    updateType: 'Reporte (Sinalização)', updateTypeKey: 'FLAG', reqType: 'REQUEST', reqSubType: 'FLAG',
    createdBy: 'world_iel6nyr4', creatorRank: 0, source: 'MOBILE_CLIENT',
    imageUrls: [foto], brand: 'Ipiranga', brandKnown: true, changes: [],
    flagType: 'DOES_NOT_MATCH_SEARCH', flagSubjectType: 'VENUE', flagEntityID: null,
    flagComment: '',
    dateAdded: 1785203731191, lat: -22.28, lon: -42.53,
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
// Espera o card ASSENTAR — animação terminada, não um relógio.
//
// O `.card-enter` anima `opacity` de 0 a 1 em 0,28s, e a verificação de
// contraste multiplica a opacidade de TODOS os ancestrais: medir no meio da
// animação dá uma cor mais misturada com o fundo e um contraste menor do que
// o real. Com 350ms fixos isso passava aqui e reprovava no CI, onde o runner
// é mais lento e a animação começa tarde — `valor-ausente 4.08:1` contra os
// 4.84:1 medidos na mesma tela localmente.
//
// Falha intermitente é pior que falha estável: ela ensina todo mundo a
// ignorar o CI. Esperar as animações TERMINAREM não depende da velocidade da
// máquina. É o gotcha #28 ("esperar ~200ms" pro anel de foco) generalizado:
// relógio fixo é palpite, `getAnimations()` é a pergunta certa.
const assentar = async (page, extra = 60) => {
  await page.evaluate(() => Promise.all(
    document.getAnimations().map((a) => a.finished.catch(() => {}))));
  await page.waitForTimeout(extra);
};

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
      await assentar(page);

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
      //
      // A lista de palavras SOZINHA dá falso positivo, e deu: `Reporte` é a
      // tradução correta de FLAG em espanhol — idêntica ao português por
      // coincidência de língua irmã. O guard reprovava um card certo, e teria
      // reprovado 17 dos 34 reportes da fila real em es.
      //
      // Só é vazamento se a palavra for do português E o dicionário do idioma
      // atual disser OUTRA coisa. Quando os dois dicionários concordam, não há
      // o que detectar — a palavra é daquela língua também.
      if (lang !== 'pt') {
        const vazou = await page.evaluate(([txt, lg]) => {
          const PT = /\b(Atualização|Novo Local|Nova Foto|Reporte|Pedido de remoção|Tipo desconhecido)\b/;
          if (!PT.test(txt)) return null;
          // O texto casa com português. Ele também é o que ESTE idioma produz?
          const dele = Object.entries(I18N_DICT[lg] || {})
            .filter(([k]) => k.startsWith('card.updateType.') || k.startsWith('card.type.'))
            .map(([, v]) => v);
          return dele.some((v) => v && txt.includes(v)) ? null : txt;
        }, [m.tipo, lang]);
        checa(!vazou, `${rot}: tipo em português`, vazou || m.tipo);
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

// ── Pedidos REAIS dos seis países obrigatórios ────────────────────────────
//
// Instrução permanente do owner (seção 🌍 do CLAUDE.md): toda medição usa o
// máximo de países, sempre incluindo Brasil, França, Reino Unido, México,
// Espanha e Portugal. A lista mora em `tools/paises-validacao.mjs`.
//
// Por que isto está no SMOKE e não só num script de bancada: até aqui as 7
// fixtures acima eram todas escritas à mão, com nome e endereço brasileiros —
// então o CI, que é quem cobra de todo mundo, nunca via um endereço britânico
// nem um `FLAGGED_PHOTO` (tipo do qual a fila do Brasil não tem NENHUM).
// A auditoria só-Brasil dava zero problema em 1872 renders enquanto 26 cards
// de outros países não cabiam no Fold. Guardar a lista num arquivo protege a
// LISTA de ser esquecida; só a fixture no CI protege a MEDIÇÃO.
//
// São pedidos reais, o mais pesado de cada país × tipo — é o pesado que quebra
// primeiro. Só `createdBy` é anonimizado: nome de local, endereço, categoria e
// geometria são dado público de mapa, e são justamente eles que decidem layout.
const FIXTURES_PAISES = JSON.parse(
  readFileSync(new URL('./fixtures-paises.json', import.meta.url), 'utf8'))
  .map((f) => ({ ...f, imageUrls: (f.imageUrls || []).map(() => foto) }));

// Os dois aparelhos em que TODAS as 104 falhas da auditoria de 12 países
// apareceram. iPhone SE e Pixel 7 zeraram — medir neles aqui seria pagar tempo
// de CI por informação que já se tem.
const APARELHOS_PAISES = [
  ['Galaxy Fold', { width: 280, height: 653 }],
  ['paisagem 852x393', { width: 852, height: 393 }],
];

for (const [aparelho, viewport] of APARELHOS_PAISES) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
  // Os tiles do mapa não são alcançáveis do CI; o que se mede aqui é layout.
  await ctx.route('**/*-tiles/**', (r) =>
    r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_CINZA }));
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  for (const lang of LINGUAS) {
    for (const place of FIXTURES_PAISES) {
      const m = await page.evaluate(async ({ pl, lang: l }) => {
        setLang(l); applyI18n();
        AppState.authenticated = true;
        AppState.profile = { userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
        AppState.stats = { read: 0, rejected: 0, skipped: 0 };
        AppState.serverTotal = 1;
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.remove('hidden');
        document.getElementById('noMoreCards').classList.add('hidden');
        showLoading(false); renderProfileHeader(AppState.profile); updateStats();
        AppState.queue = [pl]; AppState.currentPlace = pl;
        document.querySelectorAll('.place-card').forEach((e) => e.remove());
        showCurrentPlace();
        // Dois quadros + folga: medir no mesmo tick MENTE, o layout ainda não
        // assentou e o scrollHeight vem errado (gotcha #32).
        await new Promise((k) => requestAnimationFrame(() => requestAnimationFrame(k)));
        await new Promise((k) => setTimeout(k, 180));
        const card = document.querySelector('.place-card');
        if (!card) return { semCard: true };
        const cc = card.querySelector('.card-content');
        const barra = card.querySelector('.card-btn-read');
        const rb = barra ? barra.getBoundingClientRect() : null;
        return {
          // Card rolando por dentro DESLIGA o gesto de pular (gotcha #29):
          // arrastar pra cima passa a rolar. É a falha mais cara do card.
          rede: cc.classList.contains('card-content-rola'),
          acoesFora: rb ? Math.max(0, Math.round(rb.bottom - innerHeight)) : 0,
          estouroH: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      }, { pl: place, lang });
      const rot = `${aparelho} · ${lang} · ${place._pais} · ${place.purType}`;
      checa(!m.semCard, `${rot}: não renderizou`);
      checa(!m.rede, `${rot}: card rola por dentro — mata o gesto de pular`);
      checa(m.acoesFora === 0, `${rot}: barra ✕/↑/✓ fora da tela`, `${m.acoesFora}px`);
      checa(m.estouroH <= 0, `${rot}: estouro horizontal`, `${m.estouroH}px`);
    }
  }
  await ctx.close();
}

// ── A proporção da FOTO não pode decidir o layout ─────────────────────────
//
// `.card-photo` já teve `flex-basis: auto`, que resolve a base pelo tamanho
// INTRÍNSECO da <img> — a foto que o usuário tirou decidia quanto de altura
// sobrava pro texto. Medido: 800×400 → 0 estouram; 512×512 → 20; 1080×1920 →
// 31 (de 51 pedidos reais). Foto de pedido vem de celular, ou seja, retrato.
//
// As fixtures acima já usam retrato (o pior caso). Aqui os TRÊS formatos, pra
// pegar uma regressão que quebre especificamente paisagem ou quadrada — que é
// o que a fixture única não vê. Um idioma só: formato mexe em ALTURA, idioma
// mexe em largura, e cruzar os dois seria pagar 4× por nada.
const FORMATOS_FOTO = [
  ['paisagem 800x400', 800, 400],
  ['quadrada 512x512', 512, 512],
  ['retrato 1080x1920', 1080, 1920],
];
for (const [nomeF, fw, fh] of FORMATOS_FOTO) {
  const uri = 'data:image/svg+xml;base64,' + Buffer.from(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${fw}' height='${fh}'><rect width='${fw}' height='${fh}' fill='#334155'/></svg>`,
  ).toString('base64');
  for (const [aparelho, viewport] of APARELHOS_PAISES) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
    await ctx.route('**/*-tiles/**', (r) =>
      r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_CINZA }));
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(250);
    for (const place of FIXTURES_PAISES) {
      const m = await page.evaluate(async ({ pl, u }) => {
        setLang('pt'); applyI18n();
        AppState.authenticated = true;
        AppState.profile = { userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.remove('hidden');
        document.getElementById('noMoreCards').classList.add('hidden');
        showLoading(false);
        const q = { ...pl, imageUrls: (pl.imageUrls || []).map(() => u) };
        AppState.queue = [q]; AppState.currentPlace = q;
        document.querySelectorAll('.place-card').forEach((e) => e.remove());
        showCurrentPlace();
        await new Promise((k) => requestAnimationFrame(() => requestAnimationFrame(k)));
        await new Promise((k) => setTimeout(k, 170));
        const cc = document.querySelector('.card-content');
        return cc ? { rede: cc.classList.contains('card-content-rola') } : { semCard: true };
      }, { pl: place, u: uri });
      checa(!m.semCard, `foto ${nomeF} · ${aparelho} · ${place._pais}: não renderizou`);
      checa(!m.rede,
        `foto ${nomeF} · ${aparelho} · ${place._pais} · ${place.purType}: card rola — a proporção da foto voltou a mandar no layout`);
    }
    await ctx.close();
  }
}

// ── O mapa é legível? (contraste e alvo de toque) ─────────────────────────
//
// O mapa entrou por cima de tiles que mudam de cor conforme a região — parque
// verde, água azul, malha clara. Texto sobre isso não pode virar aposta: a
// legenda e a escala têm fundo próprio, e é ELE que precisa passar no WCAG.
// Medir é barato e presumir já custou caro aqui (o `.valor-ausente` foi medido
// sobre branco e reprovou sobre verde).
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  await ctx.route('**/*-tiles/**', (r) =>
    r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_CINZA }));
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  const comMapa = FIXTURES_PAISES.filter((f) => f.mapa && f.mapa.centro).slice(0, 6);
  for (const lang of LINGUAS) {
    for (const place of comMapa) {
      const m = await page.evaluate(async ({ pl, lang: l }) => {
        setLang(l); applyI18n();
        AppState.authenticated = true;
        AppState.profile = { userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.remove('hidden');
        document.getElementById('noMoreCards').classList.add('hidden');
        showLoading(false);
        AppState.queue = [pl]; AppState.currentPlace = pl;
        document.querySelectorAll('.place-card').forEach((e) => e.remove());
        showCurrentPlace();
        await new Promise((k) => setTimeout(k, 320));
        // Chega até o slide do mapa (ele pode ser o último, quando há foto).
        const prox = document.querySelector('.card-image-next');
        for (let i = 0; i < 8 && document.querySelector('.card-map.hidden'); i++) {
          if (!prox) break;
          prox.click();
          await new Promise((k) => setTimeout(k, 90));
        }
        const bx = document.querySelector('.card-map');
        if (!bx || bx.classList.contains('hidden')) return { semMapa: true };
        const lum = (c) => {
          const v = (String(c).match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number).map((x) => {
            x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
        };
        const contraste = (el) => {
          const st = getComputedStyle(el);
          let n = el, bg = st.backgroundColor;
          while (n && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { n = n.parentElement; if (n) bg = getComputedStyle(n).backgroundColor; }
          const a = lum(st.color), b = lum(bg || 'rgb(255,255,255)');
          return +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);
        };
        const baixos = [];
        for (const sel of ['.card-map-scale', '.mapa-leg', '.mapa-fora']) {
          for (const el of bx.querySelectorAll(sel)) {
            if (!el.textContent.trim()) continue;
            const c = contraste(el);
            if (c < 4.5) baixos.push(`${sel} ${c}:1`);
          }
        }
        // A navegação do carrossel continua alcançável com o mapa na tela.
        const alvos = [...document.querySelectorAll('.card-image-prev, .card-image-next')]
          .filter((b) => b.offsetParent !== null)
          .map((b) => b.getBoundingClientRect())
          .filter((r) => r.width < 44 || r.height < 44).length;
        return { baixos, alvos };
      }, { pl: place, lang });
      if (m.semMapa) continue;
      const rot = `mapa · ${lang} · ${place._pais}`;
      checa(m.baixos.length === 0, `${rot}: texto do mapa abaixo do contraste do WCAG`, m.baixos.join(', '));
      checa(m.alvos === 0, `${rot}: seta do carrossel menor que 44px com o mapa aberto`);
    }
  }
  await ctx.close();
}

// ── O mapa é dependência de TERCEIRO: como ele cai? ──────────────────────
//
// Os tiles vêm de `www.waze.com` (infra do Google — `server: nginx`,
// `via: 1.1 google`, sem nada de Cloudflare) e são abertos de propósito:
// `access-control-allow-origin: *`. Não passam pela nossa Cloudflare, então
// não custam tráfego nosso — mas TAMBÉM não estão sob nosso controle.
//
// Se o Waze mudar o caminho (404) ou bloquear (403), o card não pode quebrar
// nem ficar mudo. A evidência que o texto NÃO dá — posição relativa de antes e
// depois, linha do movimento, pontos de entrada, escala — é desenhada por nós
// e tem que sobreviver ao tile sumir. Verificado: 8 marcadores e a escala
// continuam, sem erro de JS.
for (const status of [404, 403]) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  await ctx.route('**/*-tiles/**', (r) => r.fulfill({ status }));
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 80)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  // Uma fixture em que o mapa é o PRIMEIRO slide — sem foto, ou com mudança de
  // posição. A primeira versão pegava "a primeira com mapa", que tinha foto e
  // nenhuma mudança espacial: ali o mapa é o ÚLTIMO slide e nasce escondido,
  // então o teste contava zero marcador e acusava a app de perder a evidência.
  // Instrumento errando antes do código, de novo — a mesma regra do carrossel
  // (`mapaVemPrimeiro`) tem que valer aqui.
  const alvo = FIXTURES_PAISES.find((f) => f.mapa && f.mapa.centro
    && (!(f.imageUrls || []).length
        || (f.changes || []).some((c) => c.field === 'geometry' || c.field === 'entryExitPoints')));
  const m = await page.evaluate(async (pl) => {
    setLang('pt'); applyI18n();
    AppState.authenticated = true;
    AppState.profile = { userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    document.getElementById('noMoreCards').classList.add('hidden');
    showLoading(false);
    AppState.queue = [pl]; AppState.currentPlace = pl;
    document.querySelectorAll('.place-card').forEach((e) => e.remove());
    showCurrentPlace();
    await new Promise((k) => setTimeout(k, 650));
    const bx = document.querySelector('.card-map');
    return {
      visivel: !!bx && !bx.classList.contains('hidden'),
      marcadores: bx ? bx.querySelectorAll('.card-map-marks .mapa-marca').length : 0,
      escala: bx ? (bx.querySelector('.card-map-scale')?.textContent || '').trim() : '',
      // Imagem quebrada não pode ficar no DOM: vira ícone de foto rasgada.
      tilesOrfaos: bx ? bx.querySelectorAll('.card-map-tiles img').length : 0,
      toast: [...document.querySelectorAll('#notifyStack .toast')]
        .map((t) => t.textContent.trim()).find((t) => /Erro/i.test(t)) || null,
    };
  }, alvo);
  const rot = `tile HTTP ${status}`;
  checa(m.visivel, `${rot}: o mapa sumiu inteiro — a evidência que desenhamos não depende do tile`);
  checa(m.marcadores > 0, `${rot}: os marcadores sumiram junto com o tile`);
  checa(!!m.escala, `${rot}: a barra de escala sumiu`);
  checa(m.tilesOrfaos === 0, `${rot}: ${m.tilesOrfaos} <img> quebrada ficou no DOM`);
  checa(!m.toast, `${rot}: erro na cara do editor por causa de um tile`, m.toast);
  checa(erros.length === 0, `${rot}: erro de JS na página`, erros[0]);
  await ctx.close();
}

// ── Mapa AMPLIADO: abre, navega, e fecha pelos três caminhos ─────────────
//
// Pedido dos testadores: clicar no mapa do card pra ver o entorno. A diferença
// que importa e que este teste prova: arrastar tem que BUSCAR tile novo. Se
// fosse só esticar o que o card já baixou, o gesto existiria e não revelaria
// nada — pior que não ter, porque promete.
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  const pedidos = new Set();
  await ctx.route('**/*-tiles/**', (r) => {
    pedidos.add(r.request().url());
    r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_CINZA });
  });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 80)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  // Um pedido em que o mapa é o PRIMEIRO slide (a mesma regra do carrossel):
  // com foto na frente, ele nasce escondido e não há o que clicar.
  const alvo = FIXTURES_PAISES.find((f) => f.mapa && f.mapa.centro
    && (!(f.imageUrls || []).length
        || (f.changes || []).some((c) => c.field === 'geometry' || c.field === 'entryExitPoints')));
  await page.evaluate(async (pl) => {
    setLang('pt'); applyI18n();
    AppState.authenticated = true;
    AppState.profile = { userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    document.getElementById('noMoreCards').classList.add('hidden');
    showLoading(false);
    AppState.queue = [pl]; AppState.currentPlace = pl;
    document.querySelectorAll('.place-card').forEach((e) => e.remove());
    showCurrentPlace();
    await new Promise((k) => setTimeout(k, 400));
  }, alvo);

  await page.click('.card-map');
  await page.waitForTimeout(600);
  const aberto = await page.evaluate(() => {
    const lb = document.getElementById('mapaLightbox');
    return {
      visivel: !lb.classList.contains('hidden'),
      tiles: lb.querySelectorAll('#mapaLbTiles img').length,
      marcas: lb.querySelectorAll('#mapaLbMarks .mapa-marca').length,
      escala: (lb.querySelector('#mapaLbEscala').textContent || '').trim(),
      // Os controles são alvo de toque: a régua de 44px vale aqui como no card.
      pequenos: [...lb.querySelectorAll('button')].map((b) => b.getBoundingClientRect())
        .filter((r) => r.width < 44 || r.height < 44).length,
    };
  });
  checa(aberto.visivel, 'mapa ampliado: clicar no mapa do card não abriu');
  checa(aberto.tiles > 0, 'mapa ampliado: abriu sem tile nenhum');
  checa(aberto.marcas > 0, 'mapa ampliado: abriu sem marcador — perdeu a evidência do card');
  checa(!!aberto.escala, 'mapa ampliado: sem barra de escala, a distância vira aposta');
  checa(aberto.pequenos === 0, `mapa ampliado: ${aberto.pequenos} botão menor que 44px`);

  // Arrastar longe TEM que trazer tile novo — é o que separa "mapa" de "imagem".
  const antes = pedidos.size;
  const centro0 = await page.evaluate(() => MapaLightbox.centro.slice());
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(350, 700);
    await page.mouse.down();
    await page.mouse.move(60, 200, { steps: 16 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  }
  const centro1 = await page.evaluate(() => MapaLightbox.centro.slice());
  checa(JSON.stringify(centro0) !== JSON.stringify(centro1), 'mapa ampliado: arrastar não moveu o mapa');
  checa(pedidos.size > antes,
    'mapa ampliado: arrastar não buscou tile novo — virou imagem esticada, não mapa');

  // A grade não pode acumular <img> conforme se navega.
  const nDom = await page.evaluate(() => document.querySelectorAll('#mapaLbTiles img').length);
  checa(nDom <= 24, `mapa ampliado: ${nDom} tiles no DOM depois de navegar — a limpeza parou`);

  // Zoom muda a escala; recentrar volta ao pedido.
  const escala0 = await page.evaluate(() => document.getElementById('mapaLbEscala').textContent.trim());
  await page.click('#mapaLbMais');
  await page.waitForTimeout(400);
  const escala1 = await page.evaluate(() => document.getElementById('mapaLbEscala').textContent.trim());
  checa(escala0 !== escala1, 'mapa ampliado: aproximar não mudou a escala');
  await page.click('#mapaLbCentrar');
  await page.waitForTimeout(400);
  const voltou = await page.evaluate(([c]) => JSON.stringify(MapaLightbox.centro.map((n) => +n.toFixed(4)))
    === JSON.stringify(c.map((n) => +n.toFixed(4))), [centro0]);
  checa(voltou, 'mapa ampliado: "voltar ao pedido" não recentrou');

  // Fecha por Esc (desktop) e por ✕ (toque). O voltar do aparelho é coberto
  // pelo guard de código — aqui não há histórico de navegação real.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  checa(await page.evaluate(() => document.getElementById('mapaLightbox').classList.contains('hidden')),
    'mapa ampliado: Esc não fechou');
  await page.click('.card-map');
  await page.waitForTimeout(400);
  await page.click('#mapaLbClose');
  await page.waitForTimeout(300);
  checa(await page.evaluate(() => document.getElementById('mapaLightbox').classList.contains('hidden')),
    'mapa ampliado: o ✕ não fechou');
  checa(erros.length === 0, 'mapa ampliado: erro de JS', erros[0]);
  await ctx.close();
}

// ── Lixeira do lightbox: portão, alvo e a camada da confirmação ──────────
//
// É o único caminho da app que ESCREVE no mapa em si, então a rede fica aqui e
// não só no `node --test`: quem some é o botão, e botão que aparece pra quem
// não devia só se vê renderizando. As três coisas que já mordem em app assim:
// portão furado, alvo de toque abaixo de 44px, e o diálogo que abre DE DENTRO
// do lightbox sendo fechado por baixo pelo Esc.
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  await ctx.route('**/api/excluir-foto', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }),
  }));
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 80)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);

  const IDS = ['pendente-01', 'aprovada-02'];
  const PLACE = {
    venueID: 'v-smoke', updateRequestID: 'pendente-01', name: 'Local com foto lixo',
    categories: ['PARK'], address: 'Rua X, 1', updateTypeKey: 'IMAGE', purType: 'NEW_PHOTO',
    createdBy: 'fulano', creatorRank: 0, lat: -12.9, lon: -38.3, changes: [], mapa: null,
    imageUrls: IDS.map((id) => `${foto}#${id}`),
    approvedImageIds: ['aprovada-02'],
  };
  const montar = (perfil) => page.evaluate(async ({ pl, perfil }) => {
    setLang('pt'); applyI18n();
    AppState.authenticated = true;
    API.setSession('token-smoke');   // sem token o API._post sai antes da rede
    AppState.profile = perfil;
    AppState.stats = { read: 0, rejected: 0, skipped: 0 }; AppState.serverTotal = 1;
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    document.getElementById('noMoreCards').classList.add('hidden');
    showLoading(false); renderProfileHeader(AppState.profile); updateStats();
    AppState.queue = [JSON.parse(JSON.stringify(pl))];
    AppState.currentPlace = AppState.queue[0];
    document.querySelectorAll('.place-card').forEach((e) => e.remove());
    showCurrentPlace();
    await new Promise((k) => setTimeout(k, 350));
  }, { pl: PLACE, perfil });
  // Abrir o lightbox é PRÉ-CONDIÇÃO: sem ele tudo está escondido e todo teste
  // de "não aparece" passa pelo motivo errado. Já aconteceu com este harness.
  const abrir = async () => {
    await page.evaluate(() => document.querySelector('.card-image')?.click());
    await page.waitForTimeout(300);
    return page.evaluate(() => !document.getElementById('imageLightbox').classList.contains('hidden'));
  };
  const escondido = (id) => page.evaluate((i) => document.getElementById(i).classList.contains('hidden'), id);

  await montar({ userName: 'a', rank: 5, isAreaManager: true, isStaff: false });
  checa(await abrir(), 'lixeira: o lightbox não abriu — o resto mediria o nada');
  checa(await escondido('lightboxDelete'), 'lixeira: apareceu na foto PENDENTE, que sai pelo ✕/✓ do card');
  await page.click('#lightboxNext'); await page.waitForTimeout(250);
  checa(!(await escondido('lightboxDelete')), 'lixeira: não apareceu na foto aprovada');
  const caixa = await page.evaluate(() => {
    const r = document.getElementById('lightboxDelete').getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { w: Math.round(r.width), h: Math.round(r.height), recebe: !!(el && el.closest('#lightboxDelete')) };
  });
  checa(caixa.w >= 44 && caixa.h >= 44, `lixeira: alvo de ${caixa.w}×${caixa.h}px, abaixo de 44`);
  checa(caixa.recebe, 'lixeira: o toque no centro dela chega em outro elemento');
  await page.click('#lightboxDelete'); await page.waitForTimeout(300);
  checa(!(await escondido('deletePhotoModal')), 'lixeira: a confirmação não abriu');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  checa(await escondido('deletePhotoModal'), 'lixeira: Esc não fechou a confirmação');
  checa(!(await escondido('imageLightbox')), 'lixeira: o Esc fechou a FOTO por baixo e deixou a pergunta órfã');

  for (const [nome, perfil] of [
    ['L3 AM', { userName: 'b', rank: 2, isAreaManager: true, isStaff: false }],
    ['L6 sem AM', { userName: 'c', rank: 5, isAreaManager: false, isStaff: false }],
  ]) {
    await page.evaluate(() => Lightbox.close());
    await montar(perfil);
    checa(await abrir(), `lixeira/${nome}: o lightbox não abriu`);
    await page.click('#lightboxNext'); await page.waitForTimeout(250);
    checa(await escondido('lightboxDelete'), `lixeira: ${nome} enxerga a lixeira e não devia`);
  }
  checa(erros.length === 0, 'lixeira: erro de JS', erros[0]);
  await ctx.close();
}

// ── O tile é DESENHADO no tamanho que o código pede? ─────────────────────
//
// A faixa vertical vazia que o owner viu no celular (gotcha #58): o preflight
// do Tailwind (`img,video{max-width:100%}`) cortava o tile de 512px pra
// largura da caixa, e como as posições continuam de 512 em 512 sobrava 119px
// de vão por coluna. Três instrumentos meus não viram, e o motivo de cada um
// está no gotcha — aqui ficam as duas defesas que faltavam:
//
//   · o stub é DIFERENTE por x/y (o antigo era o mesmo cinza pra todos, e com
//     isso tile cortado fica idêntico a tile certo);
//   · mede-se `getBoundingClientRect()` (o que a TELA deu), não `style.width`
//     (o que eu PEDI). Era essa troca que deixava a auditoria cega.
{
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block' });
  await ctx.route('**/*-tiles/**', (r) => {
    const m = r.request().url().match(/live\/base\/(\d+)\/(\d+)\/(\d+)\//) || [];
    r.fulfill({ status: 200, contentType: 'image/svg+xml', body:
      `<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512'>`
      + `<rect width='512' height='512' fill='${((+m[2] + +m[3]) % 2) ? '#dbeafe' : '#fef3c7'}'/>`
      + `<text x='256' y='270' font-size='40' text-anchor='middle'>${m[2]}/${m[3]}</text></svg>` });
  });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 80)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  const alvo = FIXTURES_PAISES.find((f) => f.mapa && f.mapa.centro
    && (!(f.imageUrls || []).length
        || (f.changes || []).some((c) => c.field === 'geometry' || c.field === 'entryExitPoints')));
  await page.evaluate(async (pl) => {
    setLang('pt'); applyI18n();
    AppState.authenticated = true;
    AppState.profile = { userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    document.getElementById('noMoreCards').classList.add('hidden');
    showLoading(false); renderProfileHeader(AppState.profile); updateStats();
    AppState.queue = [pl]; AppState.currentPlace = pl;
    document.querySelectorAll('.place-card').forEach((e) => e.remove());
    showCurrentPlace();
    await new Promise((k) => setTimeout(k, 500));
  }, alvo);

  const medir = (sel) => page.evaluate((s) => [...document.querySelectorAll(s + ' img')].map((im) => {
    const r = im.getBoundingClientRect();
    return { pedido: parseFloat(im.style.width), renW: +r.width.toFixed(1), renH: +r.height.toFixed(1),
             left: parseFloat(im.style.left), top: parseFloat(im.style.top), nat: im.naturalWidth };
  }), sel);
  const conferir = (nome, T, cx) => {
    if (!T.length) return checa(false, `${nome}: nenhum tile no DOM`);
    for (const t of T) {
      if (Math.abs(t.renW - t.pedido) > 0.5 || Math.abs(t.renH - t.pedido) > 0.5) {
        return checa(false, `${nome}: tile desenhado ${t.renW}×${t.renH} onde o código pede ${t.pedido} — vão entre colunas`);
      }
    }
    checa(T.every((t) => t.nat > 0), `${nome}: tile no DOM que não renderizou`);
    // Cobertura: nenhum ponto da caixa pode ficar sem tile por baixo.
    let buraco = null;
    for (let X = 4; X < cx.w && !buraco; X += 12) for (let Y = 4; Y < cx.h; Y += 12) {
      if (!T.some((t) => X >= t.left && X < t.left + t.pedido && Y >= t.top && Y < t.top + t.pedido)) { buraco = `${Math.round(X)},${Math.round(Y)}`; break; }
    }
    checa(!buraco, `${nome}: buraco sem mapa em (${buraco})`);
  };
  const caixaDe = (sel) => page.evaluate((s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; }, sel);

  conferir('mapa do card', await medir('.card-map'), await caixaDe('.card-map'));
  await page.click('.card-map'); await page.waitForTimeout(700);
  conferir('mapa ampliado', await medir('#mapaLbTiles'), await caixaDe('#mapaLbTiles'));
  await page.mouse.move(200, 500); await page.mouse.down(); await page.mouse.move(60, 260, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(600);
  conferir('ampliado após arrastar', await medir('#mapaLbTiles'), await caixaDe('#mapaLbTiles'));
  await page.click('#mapaLbMenos'); await page.waitForTimeout(600);
  conferir('ampliado após zoom −', await medir('#mapaLbTiles'), await caixaDe('#mapaLbTiles'));
  checa(erros.length === 0, 'tamanho do tile: erro de JS', erros[0]);
  await ctx.close();
}

// ── O aquecimento pede o ativo certo, do card certo, antes da hora? ──────
//
// Guard ESTÁTICO não resolve isto: quando o prefetch foi refatorado em funções
// auxiliares, o teste que exigia os literais dentro de `prefetchNextImage`
// reprovou a refatoração correta — e a versão que segue a cadeia de chamadas
// deixa passar o defeito original, porque o identificador continua na cadeia
// por outro caminho. O que decide é a REDE: qual URL foi pedida, quando, e
// para qual card.
{
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block' });
  const pedidos = [];
  const t0 = Date.now();
  // Host REAL: `img-src` da CSP não libera domínio inventado, e aí o navegador
  // nem chega a pedir — zero requisição lê como "prefetch quebrado".
  await ctx.route('https://venue-image.waze.com/**', (r) => {
    pedidos.push({ t: Date.now() - t0, tipo: 'foto', qual: r.request().url().split('thumb700_').pop() });
    r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_CINZA });
  });
  await ctx.route('**/*-tiles/**', (r) => {
    pedidos.push({ t: Date.now() - t0, tipo: 'tile', qual: 't' });
    r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_CINZA });
  });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 80)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);

  // Só o card SEGUINTE tem mapa: assim qualquer requisição de tile é dele, e
  // a asserção distingue de verdade. Com o mesmo `mapa` em todos os cards os
  // tiles saem na MESMA URL e "os tiles do próximo foram aquecidos" passaria
  // com o tile de qualquer outro — verde sem medir nada.
  const comMapa = FIXTURES_PAISES.find((f) => f.mapa && f.mapa.centro);
  // Nome do arquivo = o que o teste procura. Na primeira versão eu gerava
  // `thumb700_FA1.png` e procurava `A1.png`: reprovou por desencontro MEU.
  const foto = (n) => `https://venue-image.waze.com/thumbs/thumb700_${n}.png`;
  const base = { ...comMapa, imageUrl: null, approvedImageIds: [], changes: [], mapa: null };
  const FILA = [
    { ...base, venueID: 'A', updateRequestID: 'A', imageUrls: [foto('A1'), foto('A2')] },
    { ...base, venueID: 'B', updateRequestID: 'B', imageUrls: [foto('B1'), foto('B2'), foto('B3')], mapa: comMapa.mapa },
    { ...base, venueID: 'C', updateRequestID: 'C', imageUrls: [foto('C1'), foto('C2')] },
    { ...base, venueID: 'D', updateRequestID: 'D', imageUrls: [foto('D1'), foto('D2')] },
    { ...base, venueID: 'E', updateRequestID: 'E', imageUrls: [foto('E1')] },
  ];
  await page.evaluate(async (fila) => {
    setLang('pt'); applyI18n();
    AppState.authenticated = true; API.setSession('t');
    AppState.profile = { userName: 'a', rank: 5, isAreaManager: true, isStaff: false, profileImageUrl: '' };
    AppState.stats = { read: 0, rejected: 0, skipped: 0 }; AppState.serverTotal = fila.length;
    AppState.hasMore = false;
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    document.getElementById('noMoreCards').classList.add('hidden');
    showLoading(false); renderProfileHeader(AppState.profile); updateStats();
    AppState.queue = fila; AppState.currentPlace = fila[0];
    document.querySelectorAll('.place-card').forEach((e) => e.remove());
    showCurrentPlace();
    await new Promise((k) => setTimeout(k, 900));
  }, FILA);

  const pediu = (q) => pedidos.some((x) => x.qual === q);
  // LARGURA — o próximo card fica pronto por INTEIRO (todos os slides).
  checa(pediu('B1.png'), 'aquecimento: a 1ª foto do próximo card não foi pedida');
  checa(pediu('B2.png') && pediu('B3.png'), 'aquecimento: o próximo card não veio COMPLETO (faltaram fotos)');
  checa(pedidos.some((x) => x.tipo === 'tile'), 'aquecimento: os tiles do mapa do próximo card não foram pedidos');

  // PROFUNDIDADE — o 1º slide dos cards +2 e +3 também. É o que converte a
  // pausa de quem lê um diff em reserva pra três swipes rápidos.
  checa(pediu('C1.png'), 'aquecimento: o card +2 não teve o 1º slide aquecido (profundidade caiu)');
  checa(pediu('D1.png'), 'aquecimento: o card +3 não teve o 1º slide aquecido (profundidade caiu)');

  // A LARGURA não acompanha a profundidade: os cards +2 e +3 recebem SÓ o
  // primeiro slide. Se `C2` aparecer, o segundo laço deixou de ser preso ao
  // queue[1] e a app passou a baixar foto que ninguém pediu.
  checa(!pediu('C2.png'), 'aquecimento: o card +2 recebeu as fotos EXTRAS — a largura vazou pra profundidade');
  checa(!pediu('D2.png'), 'aquecimento: o card +3 recebeu as fotos EXTRAS — a largura vazou pra profundidade');
  // E há um fim: o card +4 fica de fora.
  checa(!pediu('E1.png'), 'aquecimento: o card +4 foi aquecido — a profundidade passou de 3');

  // Não é de uma vez só: ao avançar, a janela anda junto.
  await page.evaluate(() => {
    AppState.queue.shift();
    AppState.currentPlace = AppState.queue[0];
    document.querySelectorAll('.place-card').forEach((e) => e.remove());
    showCurrentPlace();
  });
  await page.waitForTimeout(700);
  checa(pediu('E1.png'), 'aquecimento: depois de avançar, a janela não andou (o novo +3 ficou de fora)');
  checa(pediu('C2.png'), 'aquecimento: depois de avançar, o novo "próximo" não veio COMPLETO');

  // PRIORIDADE: nada aquecido pode competir com o card na tela.
  const prio = await page.evaluate(() => {
    const im = new Image();
    return 'fetchPriority' in im ? 'suportado' : 'sem suporte no browser';
  });
  if (prio === 'suportado') {
    // O <img> do card atual NÃO pode nascer com prioridade baixa.
    const doCard = await page.evaluate(() => (document.querySelector('.card-image') || {}).fetchPriority || '');
    checa(doCard !== 'low', `prefetch: a foto do card na tela ficou com fetchPriority=${doCard}`);
  }
  checa(erros.length === 0, 'prefetch: erro de JS', erros[0]);
  await ctx.close();
}

await browser.close();
servidor.kill();

if (falhas) {
  console.log(`\n✗ smoke de browser: ${falhas} falha(s)`);
  process.exit(1);
}
console.log(`✓ smoke de browser: ${APARELHOS.length} aparelhos × ${LINGUAS.length} idiomas × ${Object.keys(CARDS).length} tipos de card`
  + `, + ${FIXTURES_PAISES.length} pedidos REAIS de ${new Set(FIXTURES_PAISES.map((f) => f._pais)).size} países × ${APARELHOS_PAISES.length} aparelhos × ${LINGUAS.length} idiomas`
  + `, + ${FORMATOS_FOTO.length} formatos de foto × ${APARELHOS_PAISES.length} aparelhos`
  + `, + legibilidade do mapa × ${LINGUAS.length} idiomas, + queda dos tiles (404/403)`
  + `, + mapa ampliado (abrir, arrastar buscando tile novo, zoom, recentrar, Esc e ✕)`
  + `, + convite de instalar em 3 telas apertadas × ${LINGUAS.length} idiomas`
  + `, + lixeira do lightbox (portão L6+AM, alvo, foto pendente e camada da confirmação)`
  + `, + tile desenhado no tamanho pedido (card e ampliado, com stub DIFERENTE por x/y)`
  + `, + aquecimento dos próximos cards medido pela REDE (profundidade, largura e prioridade)`);
