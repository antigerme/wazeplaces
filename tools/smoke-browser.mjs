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
import { setTimeout as dormir } from 'node:timers/promises';

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
    // CLOSED é o 2º motivo mais comum e a redação vem do próprio WME.
    //
    // O comentário que estava aqui dizia que INAPPROPRIATE "não ocorre nenhuma
    // vez" e que só existiam 3 tipos de reporte. As duas coisas eram falsas, e
    // vinham da mesma amostra pequena e brasileira: MEDIDO em 386 reportes de
    // 13 países, existem OITO motivos e INAPPROPRIATE aparece 21 vezes —
    // WRONG_DETAILS 125 · CLOSED 113 · RESIDENTIAL 50 · DOES_NOT_MATCH_SEARCH
    // 35 · INAPPROPRIATE 21 · UNRELATED 18 · LOW_QUALITY 14 · DUPLICATE 10.
    // O dicionário cobre os 8 nos 4 idiomas (travado em consistencia.test.mjs),
    // então nenhum editor viu enum cru — o defeito era só da documentação.
    //
    // O resíduo que este comentário registrava — motivo de duas linhas +
    // comentário longo estourando no Fold — MORREU: o motivo saiu de dentro da
    // caixa rosa e as linhas de categoria/endereço adotaram o padrão compacto.
    // Medido depois: 117 pedidos reais × 4 aparelhos × 4 idiomas = 1872 renders,
    // zero estouro (eram 156). O caso seco virou a fixture FLAG_SECO.
    flagType: 'CLOSED', flagSubjectType: 'IMAGE', flagEntityID: null,
    // 717 caracteres COM quebra de linha: é o MÁXIMO real medido em 438
    // reportes de 13 países (mediana 30, p90 90, p99 467), e 10 dos 264 com
    // texto trazem quebra. A fixture antiga tinha 213 — passava por todos os
    // checks e nunca chegou perto do pior caso. O texto é sintético mas do
    // mesmo tamanho e formato: o que decide o layout aqui é comprimento e
    // quebra, não as palavras (e copiar o texto de um usuário real não
    // acrescentaria nada além de conteúdo de terceiro numa fixture).
    flagComment: 'Esse lugar fechou faz mais de um ano, hoje é uma oficina mecânica. Passei lá ontem e confirmei com o dono do imóvel, que disse que a loja saiu em 2024 e que o ponto no mapa nunca foi corrigido desde então.\nO endereço certo da loja nova é na avenida principal, quase esquina com a rua do mercado, do lado do posto de gasolina que fica aberto de madrugada. Quem procura pelo nome antigo acaba parando na rua errada e tendo que perguntar, porque a fachada atual não tem placa nenhuma e o portão fica fechado durante o dia inteiro. Já reportei isso antes e não mudou nada, então estou mandando de novo com mais detalhes pra ajudar quem for corrigir.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
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
  // POR QUE o iPhone SE 2016 (320x568) NÃO está aqui, apesar de o CHANGELOG já
  // ter registrado o defeito da dobra nele: MEDIDO em 2026-08-16, a margem
  // entre a barra ✕/↑/✓ e o fim da tela é praticamente constante — 17px no
  // deitado e no SE 375x667, 15px no Fold, 15px no SE 2016 —, com ou sem foto e
  // com ou sem a faixa do treino. O Fold já testa exatamente a mesma margem de
  // 15px, então o aparelho a mais custaria +20% no trecho mais longo do smoke
  // pra medir o que já é medido.
  //
  // RESSALVA, medida em 2026-08-18 e que a conta acima não enxergava: aquela
  // medição olhou a MARGEM DA BARRA, e ela de fato continua boa (-9px). O que
  // o SE 2016 tem e os outros não é ESTOURO DE CONTEÚDO: num card de reporte
  // ele passa 30px mesmo SEM comentário nenhum (com 302 caracteres, 286px).
  // A rede de segurança absorve — o card vira rolável e a barra segue
  // alcançável —, mas o preço é o gesto de PULAR virar rolagem naquele
  // aparelho, e isso vale pra TODO card de reporte, não só pros longos.
  // O Fold (280x653) não estoura: card não rola, a caixa do comentário rola
  // por dentro, que é o desenho. Não está consertado, e é decisão de produto:
  // 320x568 é aparelho de 2016. Se for consertar, o alvo é a cadeia de altura
  // do card de reporte, não a caixa do comentário — ela está certa.
];
const LINGUAS = ['pt', 'en', 'es', 'fr'];

// Maior que o UNDO_WINDOW_MS do app.js: antes de a janela vencer, nada foi
// despachado, e medir ali faz "zero requisição" significar "ainda não", não
// "nunca". Foi assim que a sabotagem passou verde na primeira tentativa.
const UNDO_ESPERA_MS = 4000;

// Aparelhos do treino: os mesmos apertados que já derrubaram layout aqui — o
// Fold e o SE são quem revela corte de altura, e o deitado revela o resto.
const APARELHOS_TREINO = [['Pixel 7', { width: 412, height: 915 }], ['iPhone 14', { width: 390, height: 844 }],
  ['iPhone SE', { width: 375, height: 667 }], ['Galaxy Fold', { width: 280, height: 653 }],
  ['SE 2016', { width: 320, height: 568 }], ['deitado', { width: 852, height: 393 }]];

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
    await dormir(250);
  }
  throw new Error(`servidor não subiu em ${BASE}`);
}

const { chromium } = await carregarPlaywright();
await esperarServidor();
const browser = await abrirBrowser(chromium);

// O aviso "Como funciona" abre sozinho no PRIMEIRO card — que é exatamente o
// que todo bloco daqui renderiza. Sem suprimir, ele cobre o card com um scrim e
// os cliques dos outros testes batem nele (foi o que aconteceu: timeout no bloco
// do mapa ampliado). Suprimir aqui é o certo, não maquiagem: o assunto DELES é
// outro, e quem mede o aviso é o bloco próprio, que desliga esta supressão.
//
// Mora no `newContext` e não em cada chamada porque são ~20 contextos espalhados
// pelo arquivo: um esquecido daria falha intermitente e difícil de ligar à causa.
const _newContext = browser.newContext.bind(browser);
browser.newContext = async (opts = {}) => {
  const { primeiraVez = false, ...resto } = opts;
  const ctx = await _newContext(resto);
  if (!primeiraVez) {
    await ctx.addInitScript(() => {
      try {
        const k = 'waze_places_preferences';
        const p = JSON.parse(localStorage.getItem(k) || '{}');
        p.comoFuncionaVisto = true;
        localStorage.setItem(k, JSON.stringify(p));
      } catch (e) { /* armazenamento bloqueado: o teste segue */ }
    });
  }
  return ctx;
};

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
        // ROLAR e CORTAR não são a mesma coisa, e este helper confundia as duas:
        // `scrollHeight > clientHeight` é TRUE tanto num `overflow-y:auto` que
        // rola quanto num `overflow:hidden` que corta. Desde que o comentário
        // passou a cortar em N linhas, medir só isso acusava rolagem onde não
        // há. O que interessa aqui é o que DISPUTA COM O GESTO — e conteúdo
        // cortado não disputa com nada.
        const rola = (sel) => {
          const e = c.querySelector(sel);
          if (!e || !e.offsetParent) return null;
          if (!/auto|scroll/.test(getComputedStyle(e).overflowY)) return false;
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
        // O comentário ROLA dentro da própria caixa, numa janela de N linhas
        // INTEIRAS. Duas medidas diferentes, e confundi-las já me fez dar por
        // boa uma caixa que mostrava meia linha no Fold: `scrollHeight >
        // clientHeight` diz que SOBRA conteúdo, e só o `overflow-y` diz se ele
        // é alcançável rolando ou se está apenas cortado fora.
        const visivel = (sel) => {
          const e = c.querySelector(sel);
          return !!e && !!e.offsetParent && (e.textContent || '').trim() !== '';
        };
        const roláveisSemNome = [...c.querySelectorAll('.card-changes-list, .card-flag-comment-text')]
          .filter((e) => !e.getAttribute('aria-label')).length;
        // Teto FIXO na caixa do DIFF é a volta do bug antigo — e ele não estoura
        // nada (capar deixa o conteúdo MENOR), então só se pega olhando o
        // estilo computado: aquela caixa tem que ser dimensionada pelo flex.
        // O comentário ficou de FORA desta lista de propósito: nele o teto é o
        // projeto (janela de N linhas), e quem cobra que ele seja múltiplo
        // inteiro da linha é a checagem `sobraDaLinha`, logo abaixo.
        const comTetoFixo = [...c.querySelectorAll('.card-changes-list')]
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
        const cmt = c.querySelector('.card-flag-comment-text');
        const cmtCS = cmt ? getComputedStyle(cmt) : null;
        const cmtLinha = cmtCS ? (parseFloat(cmtCS.lineHeight) || 19) : 19;
        return {
          areas,
          comentario: cmt && cmt.offsetParent
            ? { sobra: cmt.scrollHeight > cmt.clientHeight + 1,
                alcancavel: /auto|scroll/.test(cmtCS.overflowY),
                // `clientHeight` é INTEIRO arredondado (gotcha #34), então a
                // janela de 3 linhas pode medir 57 onde a conta dá 57.75.
                // Meia linha é o defeito; 0.2 de linha é arredondamento.
                linhas: +(cmt.clientHeight / cmtLinha).toFixed(2),
                // Em PIXELS, com 1px de folga: `clientHeight` arredonda pra
                // inteiro (gotcha #34), então a janela de uma linha de 19.25px
                // mede 19 e a divisão dá 0.99. Meia linha (10px de 19) reprova
                // por uma margem enorme — não é aqui que a folga engana.
                cabeUmaLinha: cmt.clientHeight >= cmtLinha - 1,
                sobraDaLinha: +Math.abs(Math.round(cmt.clientHeight / cmtLinha) - cmt.clientHeight / cmtLinha).toFixed(2) }
            : null,
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
      if (m.comentario) {
        // A promessa desta versão, com o MAIOR comentário real (717 caracteres,
        // que é a fixture): quem rola é a CAIXA, nunca o card. Card rolando
        // desliga o arraste pra cima, e o arraste pra cima é o "pular".
        checa(!m.areas.includes('card-content'),
          `${rot}: o comentário fez o CARD rolar`, m.areas.join('+'));
        // Sobrou texto → tem que dar pra alcançar rolando. Cortar sem rolar
        // deixa o resto inacessível, que é pior que rolar.
        checa(!m.comentario.sobra || m.comentario.alcancavel,
          `${rot}: sobrou texto no comentário e a caixa não rola — fica inalcançável`);
        // Janela de linhas INTEIRAS. Meia linha visível foi o bug original, e
        // ele não estoura nada: nenhuma medida de estouro o pegaria.
        checa(m.comentario.cabeUmaLinha,
          `${rot}: a caixa do comentário colapsou`, `${m.comentario.linhas} linha(s) visível(is)`);
        checa(m.comentario.sobraDaLinha <= 0.25,
          `${rot}: a janela do comentário não é múltipla da linha`,
          `${m.comentario.linhas} linha(s) — sobra ${m.comentario.sobraDaLinha}`);
      }
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
        await dormir(180);
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
        await dormir(170);
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
        await dormir(320);
        // Chega até o slide do mapa (ele pode ser o último, quando há foto).
        const prox = document.querySelector('.card-image-next');
        for (let i = 0; i < 8 && document.querySelector('.card-map.hidden'); i++) {
          if (!prox) break;
          prox.click();
          await dormir(90);
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
    await dormir(650);
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
    await dormir(400);
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
    await dormir(350);
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
  // SEM diálogo: tocar já age. Com o Desfazer ligado (padrão), a foto some na
  // hora e o banner aparece — nada foi enviado ainda.
  const nFotosAntes = await page.evaluate(() => Lightbox.urls.length);
  await page.click('#lightboxDelete'); await page.waitForTimeout(400);
  checa(await page.evaluate(() => document.querySelectorAll('#undoContainer .undo-banner').length === 1),
    'lixeira: o banner de Desfazer não apareceu');
  checa(await page.evaluate((n) => Lightbox.urls.length === n - 1, nFotosAntes),
    'lixeira: a foto não sumiu na hora (o Desfazer adia o ENVIO, não a resposta visual)');
  // Desfazer devolve a foto.
  await page.click('#undoBtn'); await page.waitForTimeout(400);
  checa(await page.evaluate((n) => Lightbox.urls.length === n, nFotosAntes),
    'lixeira: Desfazer não devolveu a foto');
  checa(await page.evaluate(() => document.querySelectorAll('#undoContainer .undo-banner').length === 0),
    'lixeira: o banner ficou na tela depois do Desfazer');

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

// ── Aprovar foto nova: o único "aprovar" que a app tem ───────────────────
//
// A regra de ouro de produto é que a app não aprova, e a foto é a exceção
// medida — então o CI guarda exatamente as três coisas que a tornariam de novo
// uma violação: aparecer onde não é foto pendente, aparecer pra quem não passa
// no portão, e ENVIAR antes de a janela de Desfazer fechar sozinha. O terceiro
// é o que não se vê lendo código: `undoEnabled` liga um `setTimeout`, e um
// caminho que dispare o envio por fora (fechar o lightbox, trocar de foto)
// aprovaria sem a pessoa poder voltar atrás.
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  const enviados = [];
  const ordem = [];
  await ctx.route('**/api/validar-place', async (r) => {
    enviados.push(JSON.parse(r.request().postData() || '{}'));
    ordem.push('aprovar');
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, action: 'approved' }) });
  });
  await ctx.route('**/api/excluir-foto', async (r) => {
    const c = JSON.parse(r.request().postData() || '{}');
    if (c.action !== 'preparar') ordem.push('excluir');
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  // O token daqui é FALSO, então toda chamada de fundo volta 401 — e agora o
  // 401 vem carimbado e DERRUBA a sessão de verdade (era o conserto de
  // "Conexão instável" eterna). Sem este stub o bloco passava a medir a tela de
  // login em vez do lightbox. A fixture estava apoiada no defeito.
  await ctx.route('**/api/perfil', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, profile: { userName: 'a', rank: 5, isAreaManager: true, isStaff: false } }) }));
  await ctx.route('**/api/buscar-places', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, places: [], hasMore: false, total: 0 }) }));
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 80)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);

  const IDS = ['pendente-01', 'aprovada-02'];
  const PLACE = {
    venueID: 'v-aprovar', updateRequestID: 'pendente-01', name: 'Local com foto nova',
    categories: ['PARK'], address: 'Rua X, 1', updateTypeKey: 'IMAGE', purType: 'NEW_PHOTO',
    createdBy: 'fulano', creatorRank: 0, lat: -12.9, lon: -38.3, changes: [], mapa: null,
    imageUrls: IDS.map((id) => `${foto}#${id}`),
    approvedImageIds: ['aprovada-02'],
  };
  const montar = (perfil) => page.evaluate(async ({ pl, perfil }) => {
    setLang('pt'); applyI18n();
    AppState.authenticated = true;
    API.setSession('token-smoke');
    AppState.profile = perfil;
    AppState.stats = { read: 0, rejected: 0, skipped: 0 }; AppState.serverTotal = 2;
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    document.getElementById('noMoreCards').classList.add('hidden');
    showLoading(false); renderProfileHeader(AppState.profile); updateStats();
    // DOIS cards: sem o segundo não dá pra ver se o primeiro sai da fila ao
    // fechar o lightbox — a tela iria pro "Tudo limpo!" de qualquer jeito.
    AppState.queue = [JSON.parse(JSON.stringify(pl)),
      { ...JSON.parse(JSON.stringify(pl)), venueID: 'v2', updateRequestID: 'p2', name: 'Segundo' }];
    AppState.currentPlace = AppState.queue[0];
    document.querySelectorAll('.place-card').forEach((e) => e.remove());
    showCurrentPlace();
    await dormir(350);
  }, { pl: PLACE, perfil });
  const abrir = async () => {
    await page.evaluate(() => document.querySelector('.card-image')?.click());
    await page.waitForTimeout(300);
    return page.evaluate(() => !document.getElementById('imageLightbox').classList.contains('hidden'));
  };
  const escondido = (id) => page.evaluate((i) => document.getElementById(i).classList.contains('hidden'), id);

  await montar({ userName: 'a', rank: 5, isAreaManager: true, isStaff: false });
  checa(await abrir(), 'aprovar: o lightbox não abriu — o resto mediria o nada');
  checa(!(await escondido('lightboxApprove')), 'aprovar: não apareceu na foto PENDENTE, que é o caso dele');
  checa(await escondido('lightboxDelete'), 'aprovar: a lixeira apareceu junto — os dois são mutuamente exclusivos');
  const caixaAp = await page.evaluate(() => {
    const r = document.getElementById('lightboxApprove').getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { w: Math.round(r.width), h: Math.round(r.height), recebe: !!(el && el.closest('#lightboxApprove')) };
  });
  checa(caixaAp.w >= 44 && caixaAp.h >= 44, `aprovar: alvo de ${caixaAp.w}×${caixaAp.h}px, abaixo de 44`);
  checa(caixaAp.recebe, 'aprovar: o toque no centro dele chega em outro elemento');

  // Contraste do ícone contra o PREENCHIMENTO — e é por isso que ele é sólido.
  // Com `bg-black/40` a foto atravessava e o número virava função dela: sobre
  // foto clara dava 2,85:1, abaixo do mínimo 3:1 do WCAG 1.4.11. Sólido fixa.
  // A conta lê a cor COMPUTADA, não a classe: trocar a classe por uma que não
  // existe no CSS compilado deixaria o botão transparente e ninguém veria
  // (foi exatamente o que aconteceu comigo medindo isto pela primeira vez).
  const contrasteBotao = (id) => page.evaluate((i) => {
    const el = document.getElementById(i);
    const cs = getComputedStyle(el);
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const canal = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (c) => 0.2126 * canal(c[0]) + 0.7152 * canal(c[1]) + 0.0722 * canal(c[2]);
    const fundo = rgb(cs.backgroundColor);
    const alfa = Number((cs.backgroundColor.match(/[\d.]+/g) || [])[3] ?? 1);
    const [x, y] = [lum(rgb(cs.color)), lum(fundo)].sort((m, n) => n - m);
    return { c: (x + 0.05) / (y + 0.05), alfa, fundo: cs.backgroundColor };
  }, id);
  for (const [id, nome] of [['lightboxApprove', 'aprovar'], ['lightboxDelete', 'lixeira']]) {
    const m = await contrasteBotao(id);
    checa(m.alfa === 1, `${nome}: preenchimento translúcido (${m.fundo}) — a foto atravessa e o contraste vira função dela`);
    checa(m.c >= 3, `${nome}: ícone em ${m.c.toFixed(2)}:1 sobre ${m.fundo}, abaixo do mínimo 3:1`);
    // Borda de DOIS tons (`.lb-acao`). Um tom só não delimita: pra qualquer
    // preenchimento sólido existe uma foto da mesma luminância, e aí a borda
    // some. O par claro/escuro é 21:1 sempre — mas só se os DOIS estiverem lá.
    const anéis = await page.evaluate((i) => {
      const s = getComputedStyle(document.getElementById(i)).boxShadow;
      return { s, n: s === 'none' ? 0 : s.split(/,(?![^(]*\))/).length };
    }, id);
    checa(anéis.n >= 2, `${nome}: borda de ${anéis.n} tom(ns) — precisa de dois pra não sumir sobre foto da mesma cor`);
  }

  // Na foto que JÁ está no mapa é o contrário: lixeira sim, aprovar não.
  await page.click('#lightboxNext'); await page.waitForTimeout(250);
  checa(await escondido('lightboxApprove'), 'aprovar: apareceu na foto que já está no mapa');
  checa(!(await escondido('lightboxDelete')), 'aprovar: a lixeira sumiu na foto já aprovada');
  await page.click('#lightboxPrev'); await page.waitForTimeout(250);

  // A resposta visual é imediata; o ENVIO espera a janela fechar sozinha.
  enviados.length = 0;
  await page.click('#lightboxApprove'); await page.waitForTimeout(400);
  checa(await page.evaluate(() => document.querySelectorAll('#undoContainer .undo-banner').length === 1),
    'aprovar: o banner de Desfazer não apareceu');
  checa(await escondido('lightboxApprove') && !(await escondido('lightboxDelete')),
    'aprovar: o botão não virou lixeira — a foto passou a estar no mapa e o card tem que dizer isso');
  checa(enviados.length === 0, `aprovar: enviou DURANTE a janela de Desfazer (${enviados.length} chamada(s))`);
  // Botão travado precisa PARECER travado — a mesma regra dos ✕/↑/✓ do card.
  // O owner viu a divergência: "não estão sendo desativados que nem é feito nos
  // cards". Mede o ATRIBUTO e o PIXEL, porque `disabled` sem esmaecer continua
  // lendo como app quebrada (M3/HIG), e esmaecer sem `disabled` engana o Tab e
  // o leitor de tela.
  const trava = await page.evaluate(() => {
    const alvo = ['lightboxDelete', 'lightboxApprove']
      .map((i) => document.getElementById(i))
      .find((e) => e && !e.classList.contains('hidden'));
    const card = document.querySelector('.card-btn-read');
    const cs = alvo && getComputedStyle(alvo);
    return {
      id: alvo && alvo.id, disabled: !!(alvo && alvo.disabled),
      opacity: cs ? parseFloat(cs.opacity) : 1, filtro: cs ? cs.filter : 'none',
      cardTravado: !!(card && card.disabled),
    };
  });
  checa(trava.disabled, `aprovar: ${trava.id} continuou clicável durante o Desfazer`);
  checa(trava.opacity < 1 && /grayscale/.test(trava.filtro),
    `aprovar: ${trava.id} está disabled mas PARECE ativo (opacity ${trava.opacity}, filter ${trava.filtro})`);
  checa(trava.cardTravado, 'aprovar: o botão do card não travou — a regra tem que ser a MESMA nos dois');
  checa(await page.evaluate(() => AppState.queue.length === 2),
    'aprovar: o card saiu da fila antes de o lightbox fechar');
  // Fecha sozinha → envia, e com `approve: true` (o backend só aprova com o
  // booleano estrito; mandar outra coisa vira uma REJEIÇÃO silenciosa).
  await page.waitForTimeout(3200);
  checa(enviados.length === 1, `aprovar: esperava 1 envio ao fim da janela, veio ${enviados.length}`);
  checa(enviados[0] && enviados[0].approve === true,
    `aprovar: mandou approve=${JSON.stringify((enviados[0] || {}).approve)}, e só o booleano true aprova`);
  checa(await page.evaluate(() => AppState.stats.read === 0 && AppState.stats.rejected === 0 && AppState.stats.skipped === 0),
    'aprovar: mexeu no placar — aprovar foto não conta em coluna nenhuma (decisão do owner)');
  // O card só avança quando o lightbox fecha.
  await page.evaluate(() => Lightbox.close()); await page.waitForTimeout(400);
  checa(await page.evaluate(() => AppState.queue.length === 1 && AppState.currentPlace.venueID === 'v2'),
    'aprovar: ao fechar o lightbox o card não avançou, e ele já está resolvido no Waze');

  // Desfazer cancela de verdade: nada sai pela rede.
  await montar({ userName: 'a', rank: 5, isAreaManager: true, isStaff: false });
  await abrir();
  enviados.length = 0;
  await page.click('#lightboxApprove'); await page.waitForTimeout(300);
  // Sem `count()` antes do clique, uma falha ANTERIOR (o banner não aparecer)
  // vira timeout de 30s aqui e derruba o processo: o CI passa a mostrar um
  // TimeoutError no lugar da falha que realmente aconteceu.
  if (await page.locator('#undoBtn').count()) await page.click('#undoBtn');
  else checa(false, 'aprovar: sem banner de Desfazer pra cancelar — o envio já saiu');
  await page.waitForTimeout(3400);
  checa(enviados.length === 0, `aprovar: o Desfazer não cancelou — ${enviados.length} envio(s) saíram`);
  checa(!(await escondido('lightboxApprove')), 'aprovar: o Desfazer não devolveu o botão');

  // As duas escritas mexem no MESMO local, então quem chega depois tem que ver
  // o resultado de quem chegou antes. Excluir com aprovação ainda na janela
  // releria um local onde a foto está pendente, montaria a lista sem ela, e a
  // aprovação chegaria depois devolvendo a foto: o editor mandou excluir e a
  // foto fica. Hoje o banner do Desfazer TAPA a lixeira (medido: o
  // elementFromPoint devolve #undoBtn), mas isso é acidente de sobreposição —
  // por isso o teste chama a função direto, pelo caminho que o banner esconde.
  await montar({ userName: 'a', rank: 5, isAreaManager: true, isStaff: false });
  await abrir();
  ordem.length = 0;
  await page.click('#lightboxApprove'); await page.waitForTimeout(300);
  await page.evaluate(() => pedirExclusaoDaFoto());
  await page.waitForTimeout(3600);
  checa(ordem.join('→') === 'aprovar→excluir',
    `aprovar: as escritas saíram como "${ordem.join('→') || '(nada)'}" — a aprovação tem que sair ANTES da exclusão`);

  // Portão: o MESMO da lixeira, e o staff entra por fora do rank.
  for (const [nome, perfil, deveVer] of [
    ['L3 AM', { userName: 'b', rank: 2, isAreaManager: true, isStaff: false }, false],
    ['L6 sem AM', { userName: 'c', rank: 5, isAreaManager: false, isStaff: false }, false],
    ['staff L1', { userName: 'd', rank: 0, isAreaManager: false, isStaff: true }, true],
  ]) {
    await page.evaluate(() => Lightbox.close());
    await montar(perfil);
    checa(await abrir(), `aprovar/${nome}: o lightbox não abriu`);
    checa((await escondido('lightboxApprove')) !== deveVer,
      `aprovar: ${nome} ${deveVer ? 'não vê o aprovar e devia' : 'enxerga o aprovar e não devia'}`);
  }
  checa(erros.length === 0, 'aprovar: erro de JS', erros[0]);
  await ctx.close();
}

// ── Sessão morta leva pra tela de entrar; oscilação NÃO ──────────────────
//
// O incidente que originou esta passada: depois de um deploy que invalidou as
// sessões, todo testador via "Conexão instável" a cada tentativa e só saía com
// logout manual. A causa era o cliente inferir "sessão viva" da AUSÊNCIA de um
// carimbo no 401. Guard de texto não pega isto — é comportamento, e depende do
// que o SERVIDOR manda no corpo do 401.
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 80)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);

  const cenario = async (respostaDoPerfil) => page.evaluate(async (resp) => {
    setLang('pt'); applyI18n();
    window.__toasts = [];
    if (!window.__origToast) window.__origToast = window.showToast;
    window.showToast = (m, t, d) => { window.__toasts.push(String(m)); return window.__origToast(m, t, d); };
    if (!window.__origPerfil) window.__origPerfil = API.getProfile.bind(API);
    API.getProfile = async () => JSON.parse(resp);
    API.setSession('token-de-teste');
    AppState.authenticated = true;
    AppState.profile = { userName: 'x', rank: 5, isAreaManager: true, isStaff: false };
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    verificandoSessao = false;
    await handleUnauthorized();
    // A troca de tela é ADIADA de propósito (`UNAUTHORIZED_REDIRECT_MS`, pra dar
    // tempo de ler o toast), então ler na hora mede o estado anterior. Espera
    // pelo EVENTO em vez de dormir um número mágico: assim o teste segue certo
    // se alguém ajustar o atraso.
    await new Promise((k) => {
      const limite = Date.now() + 5000;
      const olha = () => {
        const naTela = !document.getElementById('authScreen').classList.contains('hidden');
        if (naTela || Date.now() > limite) k();
        else setTimeout(olha, 50);
      };
      olha();
    });
    return { toasts: window.__toasts, temToken: !!API.getSession(),
      naTelaDeLogin: !document.getElementById('authScreen').classList.contains('hidden') };
  }, JSON.stringify(respostaDoPerfil));

  // 1. Sessão morta de verdade — é o que o core manda hoje.
  const morta = await cenario({ success: false, error: 'Sessão expirada ou inválida',
    errorKey: 'srv.err.sessionExpired', errorCategory: 'unauthorized' });
  checa(!morta.toasts.some((m) => /instável|inestable|unstable|instable/i.test(m)),
    'sessão: mostrou "conexão instável" pra sessão que morreu de verdade', morta.toasts.join(' | ').slice(0, 60));
  checa(!morta.temToken, 'sessão: o token morto continuou no aparelho — a pessoa fica presa');
  checa(morta.naTelaDeLogin, 'sessão: não levou pra tela de entrar');

  // 2. O MESMO corpo sem o carimbo: era assim que o core respondia, e é o caso
  //    que prendia todo mundo. O cliente tem que decidir igual.
  const semCarimbo = await cenario({ success: false, error: 'Sessão expirada ou inválida',
    errorKey: 'srv.err.sessionExpired' });
  checa(!semCarimbo.temToken,
    'sessão: 401 SEM errorCategory voltou a ser lido como alarme falso — foi este o bug');

  // 3. Oscilação de rede NÃO pode derrubar (gotcha #42, que continua valendo).
  const oscilou = await cenario({ success: false, error: 'rede', errorCategory: 'transient' });
  checa(oscilou.temToken, 'sessão: falha passageira derrubou o editor — é o defeito oposto');
  checa(oscilou.toasts.some((m) => /instável|inestable|unstable|instable/i.test(m)),
    'sessão: falha passageira parou de avisar que foi só instabilidade');

  checa(erros.length === 0, 'sessão: erro de JS', erros[0]);
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
    await dormir(500);
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
    await dormir(900);
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


// ── Primeira execução: o aviso "Como funciona" e o "Já instalei" ─────────
// Os três botões do card só têm `aria-label` e `title`, e `title` NÃO existe no
// toque: quem nunca usou vê três círculos e adivinha. O aviso resolve isso uma
// vez só — e "uma vez só" é justamente o que quebra em silêncio quando alguém
// mexe no marcador. O outro é o beco sem saída de quem instala a extensão com a
// tela de entrada aberta: a app pergunta à extensão UMA vez, no carregamento.
{
  const cru = FIXTURES_PAISES.find((p) => (p.imageUrls || []).length && p.name) || FIXTURES_PAISES[0];
  // `primeiraVez` desliga a supressão do aviso — este bloco é justamente quem
  // o mede, então aqui ele PRECISA abrir.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', serviceWorkers: 'block', primeiraVez: true });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const montar = (pl) => page.evaluate((p) => {
    AppState.authenticated = true;
    AppState.profile = { id: 1, userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
    AppState.serverTotal = 5; AppState.hasMore = false;
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    renderProfileHeader(); updateStats(); showLoading(false);
    document.getElementById('noMoreCards').classList.add('hidden');
    AppState.queue = [p, { ...p, venueID: 'v2', updateRequestID: 'u2' }];
    AppState.currentPlace = p;
    document.querySelectorAll('.place-card').forEach((e) => e.remove());
    showCurrentPlace();
  }, pl);
  const abertoComoFunciona = () => page.evaluate(
    () => !document.getElementById('comoFuncionaModal').classList.contains('hidden'));

  await montar(cru);
  await page.waitForTimeout(600);
  checa(await abertoComoFunciona(), 'como funciona: não apareceu no primeiro card');
  // O scrim precisa COBRIR o card: senão dá pra arrastar por baixo do aviso e
  // tratar um pedido sem ler o que os botões fazem.
  checa(await page.evaluate(() => {
    const r = document.querySelector('.place-card').getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!(el && el.closest('#comoFuncionaModal'));
  }), 'como funciona: o card ficou alcançável por baixo do aviso');

  await page.click('#comoFuncionaOk');
  await page.waitForTimeout(300);
  checa(!(await abertoComoFunciona()), 'como funciona: o "Entendi" não fechou');
  await page.evaluate(() => { AppState.queue.shift(); AppState.currentPlace = null; showCurrentPlace(); });
  await page.waitForTimeout(600);
  checa(!(await abertoComoFunciona()), 'como funciona: VOLTOU no card seguinte (o marcador não pegou)');

  // Reabrir pela Ajuda não pode deixar o histórico torto. A primeira versão
  // fechava a Ajuda antes de abrir e o Esc seguinte levava a `about:blank` —
  // a pessoa saía da app inteira. Por isso o teste mede a URL, não o modal.
  await page.evaluate(() => openModal('helpModal'));
  await page.waitForTimeout(250);
  await page.click('#reverComoFunciona');
  await page.waitForTimeout(400);
  checa(await abertoComoFunciona(), 'como funciona: a Ajuda não reabriu o aviso');
  checa(await page.evaluate(() => document.getElementById('helpModal').classList.contains('hidden')),
    'como funciona: a Ajuda ficou aberta por baixo (dois modais empilhados)');
  const antes = page.url();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  checa(page.url() === antes, `como funciona: o Esc NAVEGOU pra fora da app (${page.url()})`);
  checa(!(await abertoComoFunciona()), 'como funciona: o Esc não fechou');
  await ctx.close();
}

{
  // "Já instalei — entrar": nasce escondido, aparece depois do clique em
  // instalar, e recarrega (é o reload que faz a ponte da extensão ser injetada).
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const visivel = (id) => page.evaluate((i) => {
    const e = document.getElementById(i);
    return !!e && e.offsetParent !== null;
  }, id);
  checa(!(await visivel('extJaInstalei')), 'já instalei: nasceu visível (é ruído pra quem não foi à loja)');
  await page.evaluate(() => {
    const a = document.getElementById('extInstallLink');
    a.removeAttribute('target');
    a.addEventListener('click', (e) => e.preventDefault(), true);
  });
  await page.click('#extInstallLink');
  await page.waitForTimeout(250);
  checa(await visivel('extJaInstalei'), 'já instalei: não apareceu depois do clique em instalar');
  checa(await page.evaluate(() => document.getElementById('extJaInstalei').getBoundingClientRect().height >= 44),
    'já instalei: alvo de toque abaixo de 44px');
  let recarregou = false;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) recarregou = true; });
  await page.click('#extJaInstalei');
  await page.waitForTimeout(1000);
  checa(recarregou, 'já instalei: não recarregou — sem reload a ponte da extensão não entra na aba');
  await ctx.close();
}


// ── Modo treino: a trava é medida pela REDE, não pela leitura do código ──
// Duas das três ações escrevem no Waze em nome da pessoa, e a rejeição não tem
// volta. O treino só vale se for IMPOSSÍVEL vazar — e "zero requisição" é o
// sinal mais fraco que existe, então este bloco foi construído contra três
// jeitos de ele mentir, todos descobertos na marra:
//   1. sem esperar a janela do Desfazer, nada foi despachado AINDA;
//   2. sem sessionToken, o `API.rejectPlace` sai antes do fetch;
//   3. sem exercitar os TRÊS caminhos (botão, tecla, gesto), sobra porta.
// Com o guard removido de propósito, ele acusa `POST validar-place`.
for (const lg of LINGUAS) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 },
    locale: lg === 'en' ? 'en-US' : lg, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const escritas = [];
  page.on('request', (r) => {
    if (/\/api\/(validar-place|marcar-lido|excluir-foto)/.test(r.url())) {
      escritas.push(r.url().split('/api/')[1]);
    }
  });
  await page.addInitScript((l) => localStorage.setItem('waze_places_lang', l), lg);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    API.setSession('token-de-teste');   // sem isto o POST nem é tentado
    AppState.authenticated = true;
    AppState.profile = { id: 1, userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
    AppState.stats = { read: 7, rejected: 2, skipped: 1 };
    AppState.serverTotal = 99; AppState.hasMore = false;
    AppState.queue = [{ venueID: 'real1', updateRequestID: 'r1', name: 'Local Real',
      categories: ['OTHER'], address: 'Rua Real, 1', updateType: 'Novo Local',
      updateTypeKey: 'VENUE', purType: 'NEW_PLACE', reqType: 'VENUE', createdBy: 'x',
      changes: [], imageUrls: [], mapa: null, dateAdded: Date.now() }];
    AppState.currentPlace = AppState.queue[0];
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    renderProfileHeader(); updateStats(); showLoading(false);
    document.getElementById('noMoreCards').classList.add('hidden');
    showCurrentPlace();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => Treino.entrar());
  await page.waitForTimeout(600);
  checa(await page.evaluate(() => !document.getElementById('treinoBanner').classList.contains('hidden')),
    `treino ${lg}: a faixa "nada é enviado" não apareceu`);
  checa(await page.evaluate(() => AppState.serverTotal === 3 && AppState.stats.read === 0),
    `treino ${lg}: o placar do treino não é separado do real`);

  await page.click('.card-btn-reject');       // botão
  await page.waitForTimeout(500);
  await page.keyboard.press('ArrowRight');    // tecla
  await page.waitForTimeout(500);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(900);
  // O fim do treino tem que aparecer NA HORA. Ele já esperou 2,2s pra dar tempo
  // de ler um aviso flutuante — e nesses 2,2s a área do card ficava VAZIA, porque
  // a animação do swipe já tinha tirado o card. Tela em branco lê como app
  // quebrada; hoje o efeito da última ação vai DENTRO do modal.
  const abriuEm = await (async () => {
    const t0 = Date.now();
    for (let i = 0; i < 30; i++) {
      const aberto = await page.evaluate(() => !document.getElementById('treinoFimModal').classList.contains('hidden'));
      if (aberto) return Date.now() - t0;
      await page.waitForTimeout(100);
    }
    return Infinity;
  })();
  checa(abriuEm < 1200, `treino ${lg}: o fim do treino demorou ${abriuEm}ms — deixa a área do card em branco`);

  await page.waitForTimeout(UNDO_ESPERA_MS);  // a janela do Desfazer TEM que vencer
  checa(escritas.length === 0, `treino ${lg}: VAZOU escrita ao Waze`, escritas.join(', '));
  checa(await page.evaluate(() => !document.getElementById('treinoFimModal').classList.contains('hidden')),
    `treino ${lg}: o fim do treino não apareceu`);

  // Gotcha #26 outra vez: os três avisos empilhados TAPAVAM o "Ir para a fila"
  // no Fold, no SE e no celular deitado — 3 de 4 aparelhos. Diagnóstico por
  // elementFromPoint nos cantos e no centro, não no olho.
  checa(await page.evaluate(() => {
    const btn = document.getElementById('treinoFimOk');
    const r = btn.getBoundingClientRect();
    return [[r.x + r.width / 2, r.y + r.height / 2], [r.x + 8, r.y + 4], [r.right - 8, r.bottom - 4]]
      .every(([x, y]) => { const el = document.elementFromPoint(x, y); return el === btn || btn.contains(el); });
  }), `treino ${lg}: o botão de sair do treino ficou coberto por aviso`);

  await page.click('#treinoFimOk');
  await page.waitForTimeout(700);
  const dep = await page.evaluate(() => ({
    banner: document.getElementById('treinoBanner').classList.contains('hidden'),
    fila: AppState.queue.length, atual: (AppState.currentPlace || {}).venueID,
    total: AppState.serverTotal, read: AppState.stats.read,
  }));
  checa(dep.banner && dep.fila === 1 && dep.atual === 'real1' && dep.total === 99 && dep.read === 7,
    `treino ${lg}: a fila real não voltou intacta`, JSON.stringify(dep));
  await ctx.close();
}

// ── Treino: a tela dele NÃO pode se sobrepor nem cortar os botões ────────
// A faixa "nada é enviado" nasceu dentro do #bannerStack, que é `fixed` e existe
// pra aviso TRANSITÓRIO. Faixa PERMANENTE ali flutua por cima do conteúdo pra
// sempre: ela cobria o placar em 8 de 8 aparelhos × temas, com 66px de
// sobreposição, e o owner viu no celular dele os dois textos escritos um em cima
// do outro. Passou por mim porque no tema claro a faixa é opaca — ela ESCONDEU o
// placar e eu li a captura como "faixa acima do card".
//
// Mover pra o fluxo consertou a sobreposição e criou o risco oposto (gotcha #32):
// ~50px a menos de altura pro card podem jogar os três botões abaixo da dobra.
// Por isso este bloco mede as DUAS coisas, e mais o alvo de toque.
for (const [aparelho, viewport] of APARELHOS_TREINO) {
  for (const lg of LINGUAS) {
    const ctx = await browser.newContext({ viewport, locale: lg === 'en' ? 'en-US' : lg, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.addInitScript((l) => {
      localStorage.setItem('waze_places_lang', l);
      localStorage.setItem('waze_places_preferences', JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true }));
    }, lg);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(450);
    await page.evaluate(() => {
      AppState.authenticated = true;
      AppState.profile = { id: 1, userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
      AppState.serverTotal = 99; AppState.hasMore = false;
      document.getElementById('authScreen').classList.add('hidden');
      document.getElementById('appScreen').classList.remove('hidden');
      renderProfileHeader(); updateStats(); showLoading(false);
      document.getElementById('noMoreCards').classList.add('hidden');
      Treino.entrar();
    });
    await page.waitForTimeout(700);
    const m = await page.evaluate(() => {
      const vis = (e) => e && e.offsetParent !== null && getComputedStyle(e).display !== 'none';
      // Sondas DENTRO do círculo inscrito: os botões do card são redondos, e
      // sondar os cantos da CAIXA cai fora do alvo — acusa "inalcançável" em
      // todas as combinações, que é assinatura de instrumento errado.
      const alcanca = (el) => {
        const r = el.getBoundingClientRect();
        const cx = r.x + r.width / 2, cy = r.y + r.height / 2, dx = r.width * 0.25, dy = r.height * 0.25;
        return [[cx, cy], [cx - dx, cy], [cx + dx, cy], [cx, cy - dy], [cx, cy + dy]]
          .every(([x, y]) => {
            const t = document.elementFromPoint(x, y);
            return t === el || el.contains(t)
              || (t && t.closest && t.closest('.card-btn-reject,.card-btn-skip,.card-btn-read,#treinoSairBtn') === el);
          });
      };
      const botoes = ['.card-btn-reject', '.card-btn-skip', '.card-btn-read'].map((s) => document.querySelector(s));
      const caixas = ['treinoBanner', 'placar'].map((i) => document.getElementById(i)).filter(vis)
        .concat([document.querySelector('.place-card')].filter(vis));
      let sobre = 0;
      for (let i = 0; i < caixas.length; i++) {
        for (let j = i + 1; j < caixas.length; j++) {
          const A = caixas[i].getBoundingClientRect(), B = caixas[j].getBoundingClientRect();
          sobre += Math.max(0, Math.min(A.right, B.right) - Math.max(A.left, B.left))
                 * Math.max(0, Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top));
        }
      }
      const sair = document.getElementById('treinoSairBtn');
      const doc = document.documentElement;
      return {
        semBotao: botoes.some((b) => !vis(b)),
        foraDaDobra: botoes.filter((b) => vis(b) && b.getBoundingClientRect().bottom > innerHeight).length,
        inalcancavel: botoes.filter((b) => vis(b) && !alcanca(b)).length,
        alvoPequeno: botoes.filter((b) => vis(b) && b.getBoundingClientRect().height < 44).length,
        sairOk: vis(sair) && sair.getBoundingClientRect().height >= 44 && alcanca(sair),
        sobre: Math.round(sobre),
        estouroX: Math.max(0, doc.scrollWidth - doc.clientWidth),
      };
    });
    const onde = `treino ${aparelho} ${lg}`;
    checa(m.sobre === 0, `${onde}: faixa/placar/card se sobrepõem (${m.sobre}px²)`);
    checa(!m.semBotao, `${onde}: sumiu um dos três botões do card`);
    checa(m.foraDaDobra === 0, `${onde}: ${m.foraDaDobra} botão(ões) abaixo da dobra`);
    checa(m.inalcancavel === 0, `${onde}: ${m.inalcancavel} botão(ões) cobertos por outro elemento`);
    checa(m.alvoPequeno === 0, `${onde}: alvo de toque abaixo de 44px`);
    checa(m.sairOk, `${onde}: o "Sair" do treino não está utilizável`);
    checa(m.estouroX === 0, `${onde}: estouro horizontal de ${m.estouroX}px`);
    await ctx.close();
  }
}


// ── Treino com fila REAL: as escritas de FOTO também têm que estar mortas ──
// O treino passou a usar os pedidos reais da pessoa (clonados, com o
// `updateRequestID` inerte). Isso apagou uma proteção que existia por ACIDENTE:
// os cards sintéticos não tinham foto, então o lightbox nem abria e a lixeira
// era inalcançável. Com pedido real ela abre, e o `venueID` é REAL — sem guard,
// a lixeira apaga uma foto DO MAPA enquanto a faixa promete que nada é enviado.
//
// Três armadilhas que já fizeram este teste mentir, todas cobertas aqui:
//   1. sem esperar a janela do Desfazer, nada foi despachado AINDA;
//   2. sem sessionToken, a API sai antes do fetch;
//   3. sem `approvedImageIds` + foto que CARREGA, a lixeira nem existe — e o
//      "zero escrita" dela não prova nada. Daí a CONTRAPROVA: fora do treino,
//      no mesmo card, a lixeira precisa APARECER.
{
  const PIXEL = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
  const reais = FIXTURES_PAISES.filter((p) => (p.imageUrls || []).length).slice(0, 3).map((p, i) => ({
    ...p, lat: -23.55 + i * 0.01, lon: -46.63 + i * 0.01,
    imageUrls: ['https://venue-image.waze.com/thumbs/thumb700_foto' + i],
    approvedImageIds: ['foto' + i],
  }));
  for (const lg of LINGUAS) {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 },
      locale: lg === 'en' ? 'en-US' : lg, serviceWorkers: 'block' });
    await ctx.route('https://venue-image.waze.com/**', (r) => r.fulfill({ body: PIXEL, contentType: 'image/jpeg' }));
    const page = await ctx.newPage();
    const escritas = [];
    page.on('request', (r) => {
      if (/\/api\/(validar-place|marcar-lido|excluir-foto)/.test(r.url())) escritas.push(r.url().split('/api/')[1]);
    });
    await page.addInitScript((l) => {
      localStorage.setItem('waze_places_lang', l);
      localStorage.setItem('waze_places_preferences', JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true }));
    }, lg);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(450);
    const est = await page.evaluate((fila) => {
      API.setSession('token-de-teste');   // sem isto o POST nem é tentado
      AppState.authenticated = true;
      AppState.profile = { id: 1, userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
      AppState.stats = { read: 7, rejected: 2, skipped: 1 };
      AppState.serverTotal = 99; AppState.hasMore = false;
      AppState.queue = JSON.parse(JSON.stringify(fila));
      AppState.currentPlace = AppState.queue[0];
      document.getElementById('authScreen').classList.add('hidden');
      document.getElementById('appScreen').classList.remove('hidden');
      renderProfileHeader(); updateStats(); showLoading(false);
      document.getElementById('noMoreCards').classList.add('hidden');
      showCurrentPlace();
      const idsAntes = AppState.queue.map((p) => p.updateRequestID);
      Treino.entrar();
      return { idsAntes, cards: AppState.queue.map((p) => ({ v: p.venueID, ur: p.updateRequestID })) };
    }, reais);
    const onde = `treino real ${lg}`;
    // Fila suficiente → treino 100% REAL. O sintético é PISO (fila vazia/curta),
    // não conteúdo: quem tem pedido de verdade treina no pedido de verdade.
    checa(est.cards.length === reais.length,
      `${onde}: esperava os ${reais.length} reais, veio ${est.cards.length}`);
    checa(est.cards.every((c) => !String(c.v).startsWith('treino')),
      `${onde}: sintético entrou com a fila cheia`, est.cards.map((c) => c.v).join(','));
    checa(est.cards.every((c) => c.ur === 'treino-inerte'),
      `${onde}: pedido real entrou no treino com o updateRequestID VIVO`);
    checa(est.cards.every((c) => c.v && c.v !== 'treino-inerte'),
      `${onde}: o venueID foi neutralizado — o ↗ do card deixa de abrir o lugar certo`);

    // primeiro card já é real (todos são); só garante o render assentado
    await page.evaluate(() => {
      AppState.currentPlace = AppState.queue[0];
      document.querySelectorAll('.place-card').forEach((e) => e.remove());
      showCurrentPlace();
    });
    await page.waitForTimeout(800);
    const lb = await page.evaluate(() => {
      const img = document.querySelector('.card-image');
      if (!img) return { semFoto: true };
      img.click();
      const vis = (i) => { const e = document.getElementById(i); return !!e && !e.classList.contains('hidden'); };
      return { aberto: Lightbox.isOpen(), del: vis('lightboxDelete'), apr: vis('lightboxApprove') };
    });
    checa(lb.semFoto !== true && lb.aberto, `${onde}: o lightbox não abriu — o resto do bloco não provaria nada`);
    checa(!lb.del && !lb.apr, `${onde}: lixeira/aprovar visíveis no treino`);
    const contra = await page.evaluate(() => {
      Lightbox.close();
      const era = Treino.ativo; Treino.ativo = false;
      document.querySelector('.card-image').click();
      const v = !document.getElementById('lightboxDelete').classList.contains('hidden');
      const id = Lightbox.idFotoAtual();
      Lightbox.close(); Treino.ativo = era;
      document.querySelector('.card-image').click();
      return { visivel: v, id };
    });
    checa(contra.visivel && !!contra.id,
      `${onde}: CONTRAPROVA falhou — a lixeira não aparece nem FORA do treino, então "sumiu" não prova bloqueio`);

    // força os caminhos de escrita mesmo assim
    await page.evaluate(() => {
      try { pedirExclusaoDaFoto(); } catch (e) { /* o guard é quem barra */ }
      try { aprovarFotoAtual(); } catch (e) { /* idem */ }
      try { Lightbox.close(); } catch (e) { /* idem */ }
      try { openBatchReadConfirm(); } catch (e) { /* idem */ }
    });
    await page.waitForTimeout(300);
    checa(await page.evaluate(() => document.getElementById('batchReadModal').classList.contains('hidden')),
      `${onde}: o lote abriu no treino`);
    await page.click('.card-btn-reject');    await page.waitForTimeout(500);
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500);
    await page.keyboard.press('ArrowUp');    await page.waitForTimeout(900);
    await page.waitForTimeout(UNDO_ESPERA_MS);
    checa(escritas.length === 0, `${onde}: VAZOU escrita ao Waze`, escritas.join(', '));

    await page.evaluate(() => { try { closeModal('treinoFimModal'); } catch (e) { /* pode não estar aberto */ } Treino.sair(); });
    await page.waitForTimeout(500);
    const dep = await page.evaluate(() => ({ ids: AppState.queue.map((p) => p.updateRequestID),
      total: AppState.serverTotal, read: AppState.stats.read }));
    checa(JSON.stringify(dep.ids) === JSON.stringify(est.idsAntes) && dep.total === 99 && dep.read === 7,
      `${onde}: a fila real não voltou com os ids ORIGINAIS`, JSON.stringify(dep));
    await ctx.close();
  }
}


// ── Os controles do cabeçalho, CLICADOS ─────────────────────────────────
// `semAnimar is not defined` foi pra produção e quebrou o botão de ATUALIZAR.
// A causa foi um replace que pegou a primeira ocorrência do arquivo (dentro do
// `resetQueue`) em vez da pretendida. Mas o motivo de ter CHEGADO lá é outro, e
// é o que este bloco fecha: nenhum teste jamais clicou em atualizar. Toda
// validação injetava estado direto no AppState e pulava o `resetQueue()`.
//
// Duas coisas importam aqui, e as duas já me morderam:
//   1. entrar por `showMainScreen()`, não montando o DOM à mão — é ele que
//      REVELA os controles do cabeçalho; sem isso o clique nem acontece;
//   2. medir `pageerror`, não o resultado visível: um ReferenceError aborta a
//      função no meio e a tela pode não mudar nada.
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'pt-BR', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.addInitScript(() => localStorage.setItem('waze_places_preferences',
    JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true })));
  await page.route('**/api/buscar-places', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, places: [], hasMore: false, page: 1, total: 0 }) }));
  await page.route('**/api/perfil', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, profile: { id: 1, userName: 'a', rank: 5, isAreaManager: true, isStaff: false, areas: [] } }) }));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.evaluate((fila) => {
    API.setSession('token-de-teste');
    AppState.authenticated = true;
    AppState.profile = { id: 1, userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
    AppState.stats = { read: 22, rejected: 41, skipped: 0 };
    AppState.serverTotal = 118; AppState.hasMore = false;
    AppState.queue = JSON.parse(JSON.stringify(fila));
    AppState.currentPlace = AppState.queue[0];
    showMainScreen();
    renderProfileHeader(); updateStats(); showLoading(false);
    document.getElementById('noMoreCards').classList.add('hidden');
    showCurrentPlace();
  }, FIXTURES_PAISES.slice(0, 3));
  await page.waitForTimeout(600);

  const passos = [
    ['refreshBtn', 1500, 'ATUALIZAR'],
    ['filtersBtn', 600, 'abrir Filtros'],
    ['applyFilters', 1500, 'aplicar Filtros'],
    ['themeBtn', 400, 'trocar tema'],
    ['themeBtn', 400, 'trocar tema de volta'],
    ['helpBtn', 600, 'abrir Ajuda'],
    ['closeHelp', 400, 'fechar Ajuda'],
  ];
  for (const [id, espera, nome] of passos) {
    const antes = erros.length;
    const el = await page.$('#' + id);
    if (!el) { checa(false, `controles: #${id} não existe`); continue; }
    await el.click().catch(() => {});
    await page.waitForTimeout(espera);
    checa(erros.length === antes, `controles: "${nome}" lançou erro de JS`, erros[antes]);
  }
  await ctx.close();
}


// ── Ponto no ícone da app instalada ─────────────────────────────────────
// Espiona `setAppBadge`/`clearAppBadge` em vez de depender do sistema: o badge
// de verdade só existe com a app INSTALADA, e o que este projeto controla é
// QUANDO chama e COM O QUÊ. Três coisas que quebram calado se alguém mexer:
//   1. mandar NÚMERO em vez de ponto — o badge só é escrito quando a app roda,
//      então um número fica velho no instante em que ela fecha;
//   2. PEDIR permissão de notificação — prompt não solicitado é a interrupção
//      que a régua do projeto proíbe, e no iOS é o que o badge exigiria;
//   3. deixar a promessa REJEITADA escapar — no iOS sem permissão ela rejeita,
//      e um "unhandled rejection" por sessão é ruído que mascara erro real.
for (const suporte of [true, false]) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'pt-BR', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.addInitScript((sup) => {
    localStorage.setItem('waze_places_preferences', JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true, undoGateSeen: true, dicaDesfazerVista: true }));
    window.__badge = []; window.__permPedida = false;
    if (sup) {
      navigator.setAppBadge = (...a) => { window.__badge.push(['set', a.length ? a[0] : 'ponto']); return Promise.resolve(); };
      navigator.clearAppBadge = () => { window.__badge.push(['clear']); return Promise.resolve(); };
    } else { delete navigator.setAppBadge; delete navigator.clearAppBadge; }
    if (window.Notification) Notification.requestPermission = () => { window.__permPedida = true; return Promise.resolve('denied'); };
  }, suporte);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.evaluate((fila) => {
    API.setSession('token-de-teste');
    AppState.authenticated = true;
    AppState.profile = { id: 1, userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
    AppState.serverTotal = 118; AppState.hasMore = false;
    AppState.queue = JSON.parse(JSON.stringify(fila)); AppState.currentPlace = AppState.queue[0];
    showMainScreen(); renderProfileHeader(); updateStats(); showLoading(false);
    document.getElementById('noMoreCards').classList.add('hidden'); showCurrentPlace();
  }, FIXTURES_PAISES.slice(0, 3));
  await page.waitForTimeout(600);
  const onde = suporte ? 'badge (com suporte)' : 'badge (sem suporte)';
  if (suporte) {
    const r1 = await page.evaluate(() => window.__badge);
    checa(r1.some((x) => x[0] === 'set' && x[1] === 'ponto'), `${onde}: não pediu o PONTO`, JSON.stringify(r1));
    checa(!r1.some((x) => x[0] === 'set' && typeof x[1] === 'number'),
      `${onde}: mandou NÚMERO — ele fica velho assim que a app fecha`, JSON.stringify(r1));
    await page.evaluate(() => { window.__badge = []; AppState.serverTotal = 0; updatePendingCount(); });
    const r2 = await page.evaluate(() => window.__badge);
    checa(r2.length && r2[r2.length - 1][0] === 'clear', `${onde}: fila zerada não limpou o ponto`, JSON.stringify(r2));
    // A fila VOLTA a ter itens antes de testar o logout. Sem isto o teste passava
    // pelo motivo errado: com `serverTotal` ainda em 0 do passo anterior, o
    // `clear` acontecia por não haver trabalho, e não por estar deslogado —
    // medido, a sabotagem que tira o `authenticated` da condição passou VERDE.
    await page.evaluate(() => {
      window.__badge = []; AppState.serverTotal = 42; AppState.authenticated = false; updatePendingCount();
    });
    const r3 = await page.evaluate(() => window.__badge);
    checa(r3.length && r3[r3.length - 1][0] === 'clear',
      `${onde}: deslogado com fila cheia não limpou o ponto`, JSON.stringify(r3));
    // rejeição (iOS sem permissão) não pode virar unhandled rejection
    await page.evaluate(() => { navigator.setAppBadge = () => Promise.reject(new Error('NotAllowedError')); AppState.authenticated = true; AppState.serverTotal = 5; updatePendingCount(); });
    await page.waitForTimeout(400);
  } else {
    await page.click('#refreshBtn').catch(() => {});
    await page.waitForTimeout(1000);
    checa(!!(await page.evaluate(() => document.getElementById('pendingCount').textContent)),
      `${onde}: o placar parou de funcionar sem a API de badge`);
  }
  checa(!(await page.evaluate(() => window.__permPedida)), `${onde}: PEDIU permissão de notificação`);
  checa(erros.length === 0, `${onde}: erro de JS`, erros[0]);
  await ctx.close();
}

// ── Aviso de sessão vencendo ────────────────────────────────────────────
// Indicador de ESTADO, então mora no fluxo (dentro do #placar) e não no
// #bannerStack, que é `fixed` e serve a avisos que passam — permanente ali
// cobriria o card (gotcha #26). Quatro coisas que quebram calado:
//   1. o limiar errar pro lado da folga — aparecer com muito prazo vira ruído,
//      e o número na tela nunca pode ser MAIOR do que o prazo real;
//   2. sobreviver ao logout ou ao prazo já vencido — a frase passaria a falar
//      de uma sessão que não existe mais;
//   3. estourar a caixa em francês, que é a língua mais larga (gotcha #25), no
//      aparelho mais estreito;
//   4. virar alvo de toque pequeno logo acima da área de swipe.
const DIAS = (d) => Math.floor(Date.now() / 1000) + Math.round(d * 86400);
for (const [aparelho, viewport] of [['Galaxy Fold', { width: 280, height: 653 }], ['Pixel 7', { width: 412, height: 915 }]]) {
  for (const lang of LINGUAS) {
    const ctx = await browser.newContext({ viewport, locale: lang === 'en' ? 'en-US' : lang, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    await page.addInitScript((lg) => {
      localStorage.setItem('waze_places_lang', lg);
      localStorage.setItem('waze_places_preferences', JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true, undoGateSeen: true, dicaDesfazerVista: true }));
    }, lang);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.evaluate((fila) => {
      API.setSession('token-de-teste');
      AppState.authenticated = true;
      AppState.profile = { id: 1, userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
      AppState.serverTotal = 118; AppState.hasMore = false;
      AppState.queue = JSON.parse(JSON.stringify(fila)); AppState.currentPlace = AppState.queue[0];
      showMainScreen(); renderProfileHeader(); updateStats(); showLoading(false);
      document.getElementById('noMoreCards').classList.add('hidden'); showCurrentPlace();
    }, FIXTURES_PAISES.slice(0, 3));
    await assentar(page);
    const onde = `aviso de sessão · ${aparelho} · ${lang}`;

    // Quando aparece e quando NÃO aparece. O `10 dias` é o caso que mais
    // importa: prazo folgado com aviso na tela é o que ensina a ignorar avisos.
    const estados = await page.evaluate((prazos) => {
      const el = () => document.getElementById('avisoSessao');
      const ver = () => !el().classList.contains('hidden');
      const out = {};
      for (const [rot, quando] of Object.entries(prazos)) {
        AppState.authenticated = rot !== 'deslogado';
        AppState.sessaoExpiraEm = quando;
        updatePendingCount();
        out[rot] = { visivel: ver(), txt: el().textContent };
      }
      AppState.authenticated = true;
      return out;
    }, {
      '10 dias': DIAS(10), '5 dias': DIAS(5.4), '1 dia': DIAS(1.4),
      hoje: DIAS(0.3), vencido: DIAS(-0.5), deslogado: DIAS(2), 'sem prazo': null,
    });
    for (const rot of ['10 dias', 'vencido', 'deslogado', 'sem prazo']) {
      checa(!estados[rot].visivel, `${onde}: apareceu com "${rot}"`, estados[rot].txt);
    }
    for (const rot of ['5 dias', '1 dia', 'hoje']) {
      checa(estados[rot].visivel, `${onde}: NÃO apareceu com "${rot}"`);
      checa(!/[{}]|undefined|NaN/.test(estados[rot].txt),
        `${onde}: placeholder cru na frase de "${rot}"`, estados[rot].txt);
    }
    // Nunca prometer mais prazo do que existe: com 1,4 dia o certo é "1", não "2".
    checa(/(^|\D)1(\D|$)/.test(estados['1 dia'].txt) && !/(^|\D)2(\D|$)/.test(estados['1 dia'].txt),
      `${onde}: arredondou o prazo pra cima`, estados['1 dia'].txt);

    // Cabe na caixa, não é alvo de toque, e não tapa nada.
    //
    // O `visivel` não é zelo: o laço acima termina em "sem prazo", que ESCONDE o
    // aviso, e medir elemento escondido dá caixa 0×0 em (0,0) — que "estoura"
    // o pai pela esquerda e cai fora do `elementFromPoint`. Reprovou 16 de 16,
    // em aparelho e idioma onde a medição manual dava limpo: achado que acusa
    // tudo é o instrumento, não a app (gotcha #28).
    const m = await page.evaluate((quando) => {
      const el = document.getElementById('avisoSessao');
      AppState.sessaoExpiraEm = quando;
      updatePendingCount();
      const visivel = !el.classList.contains('hidden');
      const r = el.getBoundingClientRect();
      const pai = el.parentElement.getBoundingClientRect();
      const pts = [[r.x + r.width / 2, r.y + r.height / 2], [r.x + 4, r.y + 2], [r.right - 4, r.bottom - 2]];
      // Fundo COMPOSTO: o #placar é `bg-white/80`, então pegar o primeiro fundo
      // não-transparente e ignorar o alfa mede outra coisa (gotcha #40). Aqui as
      // camadas são misturadas de trás pra frente. Conferido contra o PIXEL de
      // um recorte real: 7,02:1 no claro e 10,55:1 no escuro.
      const nums = (c) => (String(c).match(/[\d.]+/g) || []).map(Number);
      const camadas = [];
      for (let n = el; n; n = n.parentElement) {
        const v = nums(getComputedStyle(n).backgroundColor);
        if (v.length < 3) continue;
        const a = v.length > 3 ? v[3] : 1;
        if (a <= 0) continue;
        camadas.push([v[0], v[1], v[2], a]);
        if (a >= 1) break;
      }
      let base = nums(getComputedStyle(document.documentElement).backgroundColor);
      if (base.length < 3 || (base.length > 3 && base[3] === 0)) base = [255, 255, 255];
      for (let i = camadas.length - 1; i >= 0; i--) {
        const [cr, cg, cb, a] = camadas[i];
        base = [cr * a + base[0] * (1 - a), cg * a + base[1] * (1 - a), cb * a + base[2] * (1 - a)];
      }
      const lum = (c) => {
        const v = c.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      };
      const a = lum(nums(getComputedStyle(el).color)), b = lum(base);
      return {
        visivel,
        estoura: r.right > pai.right + 0.5 || r.left < pai.left - 0.5,
        rolaX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        tapado: pts.some(([x, y]) => { const e = document.elementFromPoint(x, y); return !(e === el || el.contains(e)); }),
        clicavel: el.tagName !== 'P' || getComputedStyle(el).cursor === 'pointer' || !!el.closest('a,button'),
        contraste: +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2),
      };
    }, DIAS(3));
    checa(m.visivel, `${onde}: medindo o aviso ESCONDIDO — a caixa 0×0 faz todo o resto mentir`);
    checa(!m.estoura && !m.rolaX, `${onde}: o texto estourou a caixa`);
    checa(!m.tapado, `${onde}: alguma coisa cobre o aviso`);
    checa(!m.clicavel, `${onde}: virou alvo de toque — aqui é logo acima do swipe, e a régua é 44px`);
    checa(m.contraste >= 4.5, `${onde}: contraste abaixo do WCAG 1.4.3`, `${m.contraste}:1`);

    // O prazo é do APARELHO e some no "Sair" (contrato do logout).
    //
    // UM valor, calculado UMA vez. Chamar `DIAS(3)` de novo na comparação lê o
    // relógio outra vez: se o segundo virar entre as duas leituras, o esperado
    // difere do gravado por 1 e o teste reprova sem defeito nenhum. Foi o que
    // aconteceu — CI vermelho num PR só de documentação, com 1787137727 contra
    // 1787137728. Falha intermitente é pior que falha estável: ensina todo mundo
    // a ignorar o CI.
    const prazoDeTeste = DIAS(3);
    const guarda = await page.evaluate((quando) => {
      guardarPrazoDaSessao({ sessaoExpiraEm: quando });
      const gravado = localStorage.getItem('waze_places_sessao_expira');
      // Resposta SEM o campo não pode apagar o que já se sabia: o Waze só manda
      // `Set-Cookie` quando rotaciona, e ausência não desmente a última medida.
      guardarPrazoDaSessao({ success: true });
      const apos = localStorage.getItem('waze_places_sessao_expira');
      esquecerPrazoDaSessao();
      return { gravado, apos, aposSair: localStorage.getItem('waze_places_sessao_expira') };
    }, prazoDeTeste);
    checa(guarda.gravado === String(prazoDeTeste), `${onde}: não guardou o prazo no aparelho`, String(guarda.gravado));
    checa(guarda.apos === guarda.gravado, `${onde}: resposta sem o campo APAGOU o prazo já conhecido`);
    checa(guarda.aposSair === null, `${onde}: o prazo sobreviveu ao "Sair"`);
    checa(erros.length === 0, `${onde}: erro de JS`, erros[0]);
    await ctx.close();
  }
}

// ── Treino: quantos cards, quais, e o contador ──────────────────────────
// Três coisas que quebram calado:
//   1. o "Restam" divergir do número de cards — estava assim (cravado em 3
//      enquanto o treino montava 4), e o contador zerava com card na tela;
//   2. o piso sumir — fila vazia tem que dar treino do mesmo jeito, e é no
//      primeiro minuto (logo depois do "Como funciona") que ela ainda não
//      carregou;
//   3. a ordem voltar a ser a da fila. MEDIDO nos 6 países obrigatórios: 30
//      cards em ordem de fila cobrem 5 a 8 dos 7 a 11 tipos que existem; por
//      variedade, cobrem TODOS nos seis. Na fila do Brasil os 3 primeiros são
//      do MESMO tipo — o treino antigo mostrava 1 tipo de 10 e chamava de treino.
{
  const chave = (p) => `${p.updateTypeKey || '—'}|${(p.imageUrls || []).length ? 'foto' : 'sem'}`;
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'pt-BR', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.addInitScript(() => localStorage.setItem('waze_places_preferences',
    JSON.stringify({ undoEnabled: false, comoFuncionaVisto: true, undoGateSeen: true, dicaDesfazerVista: true })));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  for (const n of [0, 1, 3, 10, FIXTURES_PAISES.length]) {
    const m = await page.evaluate(([fila, k]) => {
      if (Treino.ativo) Treino.sair();
      API.setSession('token-de-teste');
      AppState.authenticated = true;
      AppState.profile = { id: 1, userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
      AppState.serverTotal = fila.length; AppState.hasMore = false;
      AppState.queue = JSON.parse(JSON.stringify(fila));
      AppState.currentPlace = AppState.queue[0] || null;
      showMainScreen(); renderProfileHeader(); updateStats(); showLoading(false);
      Treino.entrar();
      const q = AppState.queue;
      const chaveDe = (p) => `${p.updateTypeKey || '—'}|${(p.imageUrls || []).length ? 'foto' : 'sem'}`;
      return {
        cards: q.length,
        restam: document.getElementById('pendingCount').textContent,
        // Nenhum card pode carregar `updateRequestID` real: é a 2ª camada de
        // proteção das escritas (a 1ª é o guard no topo dos handlers).
        naoInertes: q.filter((p) => p.updateRequestID !== Treino.UR_INERTE && p.updateRequestID !== 'treino').length,
        sinteticos: q.filter((p) => String(p.venueID).startsWith('treino')).length,
        distintos5: new Set(q.slice(0, 5).map(chaveDe)).size,
        max: Treino.MAX_REAIS, min: Treino.MIN_CARDS,
        // Só pra MENSAGEM. A conta abaixo usa os números literais: ler a
        // constante do app faz o teste se ajustar à mudança em vez de reprová-la
        // — medido, a sabotagem "teto 30 → 3" passou por este caminho e só caiu
        // por tabela, na checagem de variedade, com a mensagem errada.
      };
    }, [FIXTURES_PAISES.slice(0, n), null]);
    const onde = `treino · fila de ${n}`;
    checa(String(m.cards) === String(m.restam),
      `${onde}: "Restam" (${m.restam}) diverge dos cards (${m.cards}) — o contador zera com card na tela`);
    // EXATO e com os números ESCRITOS AQUI (30 e 3), não lidos do app: `<= teto`
    // passaria com um teto de 3 — a regressão pro desenho antigo que este bloco
    // existe pra pegar — e ler `Treino.MAX_REAIS` faz o esperado mudar junto com
    // a sabotagem. Mexer no teto passa a exigir mexer aqui, que é o ponto.
    const TETO = 30, PISO = 3;
    checa(m.max === TETO && m.min === PISO,
      `${onde}: as constantes do treino mudaram (teto ${m.max}, piso ${m.min}) — decida aqui também`);
    const esperadoCards = n <= PISO ? PISO : Math.min(n, TETO);
    checa(m.cards === esperadoCards,
      `${onde}: esperava ${esperadoCards} cards (piso ${PISO}, teto ${TETO}), veio ${m.cards}`);
    checa(m.naoInertes === 0, `${onde}: card com updateRequestID REAL dentro do treino`, String(m.naoInertes));
    // Sintético é PISO, não conteúdo: com fila suficiente não entra nenhum.
    checa(n >= m.min ? m.sinteticos === 0 : m.cards === m.min,
      `${onde}: sintético apareceu com fila suficiente (ou o piso não completou)`, `sint=${m.sinteticos} cards=${m.cards}`);
    // Variedade na FRENTE: quem sair no 5º card viu 5 tipos, não 5 vezes o mesmo.
    // O esperado sai do RECORTE, não do arquivo inteiro: o rodízio não inventa
    // tipo que não existe na entrada. Comparar com os 7 tipos das 51 fixtures
    // reprovava a fila de 10 (que só tem 3) — instrumento errado, não app.
    const gruposNoRecorte = new Set(FIXTURES_PAISES.slice(0, n).map(chave)).size;
    if (n >= 5) {
      const esperado = Math.min(5, gruposNoRecorte);
      checa(m.distintos5 >= esperado,
        `${onde}: os 5 primeiros repetem tipo — a ordem voltou a ser a da fila`, `${m.distintos5} de ${esperado}`);
    }
  }
  checa(erros.length === 0, 'treino (contagem e variedade): erro de JS', erros[0]);
  await ctx.close();
}

// ── A foto de perfil não pode competir com a foto do PEDIDO ─────────────
// Ela é a imagem mais pesada da app (214 KB, medido na produção) e aparece com
// 32px. A regra: nem começa a ser buscada antes de a tela estar pronta.
//
// Medido pela REDE, não por flag interna — o que importa é o que sai do
// aparelho. E com PROVA POSITIVA nos dois sentidos: "não pediu ainda" sozinho
// passaria também se o avatar nunca carregasse, que seria um defeito pior.
{
  const AVATAR = 'https://social-row.waze.com/SocialMediaServer/images/profile/teste-abc';
  const PX = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
  for (const cenario of ['com fila', 'fila vazia']) {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'pt-BR', serviceWorkers: 'block' });
    const pedidos = [];
    await ctx.route('https://social-row.waze.com/**', (r) => { pedidos.push('avatar'); return r.fulfill({ body: PX, contentType: 'image/jpeg' }); });
    await ctx.route('https://venue-image.waze.com/**', (r) => { pedidos.push('foto-do-card'); return r.fulfill({ body: PX, contentType: 'image/jpeg' }); });
    await ctx.route('https://www.waze.com/**', (r) => r.fulfill({ body: PX, contentType: 'image/png' }));
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    await page.addInitScript(() => localStorage.setItem('waze_places_preferences',
      JSON.stringify({ undoEnabled: false, comoFuncionaVisto: true, undoGateSeen: true, dicaDesfazerVista: true })));
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const onde = `avatar · ${cenario}`;

    // Perfil chega ANTES da tela ficar pronta — é a ordem real: o `perfil` e o
    // `buscar-places` saem quase juntos, e o perfil costuma voltar primeiro.
    await page.evaluate(([av, fila]) => {
      API.setSession('token-de-teste');
      AppState.authenticated = true;
      AppState.profile = { id: 1, userName: 'a', rank: 5, isAreaManager: true, isStaff: false, profileImageUrl: av };
      AppState.serverTotal = fila.length; AppState.hasMore = false;
      AppState.queue = JSON.parse(JSON.stringify(fila));
      AppState.currentPlace = AppState.queue[0] || null;
      showMainScreen(); renderProfileHeader(); updateStats(); showLoading(false);
    }, [AVATAR, cenario === 'com fila' ? FIXTURES_PAISES.filter((p) => (p.imageUrls || []).length).slice(0, 2) : []]);
    await page.waitForTimeout(900);
    checa(!pedidos.includes('avatar'),
      `${onde}: a foto de perfil foi buscada ANTES da tela ficar pronta`, pedidos.join(' → '));
    // A caixa tem que estar reservada desde já, senão a foto chegando empurra o cabeçalho.
    const cx = await page.evaluate(() => {
      const el = document.getElementById('userAvatar');
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), visivel: getComputedStyle(el).display !== 'none' };
    });
    checa(cx.visivel && cx.w >= 24 && cx.h >= 24,
      `${onde}: a caixa do avatar não está reservada — a foto vai empurrar o cabeçalho quando chegar`, JSON.stringify(cx));

    // Agora a tela fica pronta. PROVA POSITIVA: o avatar TEM que chegar.
    await page.evaluate((temFila) => { if (temFila) showCurrentPlace(); else showNoPlaces(); }, cenario === 'com fila');
    await page.waitForTimeout(2600);   // idle + o timeout de 2s do requestIdleCallback
    checa(pedidos.includes('avatar'),
      `${onde}: a foto de perfil NUNCA chegou — o editor fica com o cinza pra sempre`, pedidos.join(' → '));
    if (cenario === 'com fila') {
      checa(pedidos.indexOf('foto-do-card') < pedidos.indexOf('avatar'),
        `${onde}: a foto de perfil passou na frente da foto do pedido`, pedidos.join(' → '));
    }
    checa(erros.length === 0, `${onde}: erro de JS`, erros[0]);
    await ctx.close();
  }
}

// ── A CSP não pode bloquear nada nosso ──────────────────────────────────
// O tema é um <script> INLINE autorizado por HASH. Hash defasado BLOQUEIA o
// script, e o sintoma é sutil: a app abre no esquema errado por um instante e
// nada "quebra". Medido com o hash sabotado — o `tema-claro` some e o console
// registra "Refused to execute inline script".
//
// Vale como rede geral: qualquer violação de CSP nossa aparece aqui.
for (const tema of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const violacoes = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to (execute|load)/i.test(m.text())) violacoes.push(m.text().slice(0, 120)); });
  await page.addInitScript((t) => localStorage.setItem('waze_places_theme', t), tema);
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const classes = await page.evaluate(() => [...document.documentElement.classList]);
  checa(violacoes.length === 0, `CSP · ${tema}: violação de CSP na carga`, violacoes[0]);
  checa(classes.includes(tema === 'dark' ? 'dark' : 'tema-claro'),
    `CSP · ${tema}: o script de tema não marcou a raiz ANTES do paint — hash defasado?`, JSON.stringify(classes));
  await ctx.close();
}

// ── Tira de miniaturas do lightbox ─────────────────────────────────────
// Ela ENTRA no layout em vez de flutuar, e o motivo é medido: a tarja livre do
// `object-contain` some no iPhone SE com foto retrato (27px) e no celular
// deitado (0px). Flutuar cobriria justamente a foto que decide o pedido.
//
// Quatro coisas que quebram calado:
//   1. voltar a flutuar — cobre a foto, e no aparelho onde ninguém testa;
//   2. cobrir a dica de zoom ou os botões de excluir/aprovar;
//   3. miniatura menor que 44px de alvo;
//   4. a tira pedir URL NOVA. Ela tem que reusar a mesma do carrossel, que o
//      aquecimento já trouxe — o `thumb100_` do Waze é 25x menor, mas é outra
//      URL, então seriam 4 requisições e ~12,8 KB por local por fotos que o
//      aparelho já tem. Achado do owner; ver a nota em js/app.js.
const PX_TIRA = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
for (const [aparelho, viewport] of [['Galaxy Fold', { width: 280, height: 653 }],
                                    ['deitado', { width: 852, height: 393 }],
                                    ['iPhone SE 2016', { width: 320, height: 568 }]]) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR', serviceWorkers: 'block' });
  await ctx.route('https://venue-image.waze.com/**', (r) => r.fulfill({ body: PX_TIRA, contentType: 'image/jpeg' }));
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.addInitScript(() => localStorage.setItem('waze_places_preferences',
    JSON.stringify({ undoEnabled: false, comoFuncionaVisto: true, undoGateSeen: true, dicaDesfazerVista: true })));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  for (const nFotos of [1, 4]) {
    const m = await page.evaluate(([fila, n]) => {
      const p = JSON.parse(JSON.stringify(fila[0]));
      p.imageUrls = Array.from({ length: n }, (_, i) => `https://venue-image.waze.com/thumbs/thumb700_f${i}`);
      API.setSession('token-de-teste'); AppState.authenticated = true;
      AppState.profile = { id: 1, userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
      AppState.serverTotal = 9; AppState.hasMore = false;
      AppState.queue = [p]; AppState.currentPlace = p;
      showMainScreen(); renderProfileHeader(); updateStats(); showLoading(false);
      document.getElementById('noMoreCards').classList.add('hidden'); showCurrentPlace();
      if (Lightbox.isOpen()) Lightbox.close();
      Lightbox.open(p.imageUrls, 0, 0, 'teste', false, p);
      const tira = document.getElementById('lightboxStrip');
      const lb = document.getElementById('imageLightbox');
      const visivel = !tira.classList.contains('hidden');
      const tr = tira.getBoundingClientRect();
      const im = document.getElementById('lightboxImage').getBoundingClientRect();
      const minis = [...tira.querySelectorAll('.lb-mini')].map((b) => b.getBoundingClientRect());
      const baixos = ['lightboxZoomHint', 'lightboxDelete', 'lightboxApprove']
        .map((id) => document.getElementById(id)).filter((e) => e && !e.classList.contains('hidden'))
        .map((e) => e.getBoundingClientRect());
      const src = (tira.querySelector('.lb-mini img') || {}).src || '';
      return {
        visivel, comTira: lb.classList.contains('com-tira'), nMinis: minis.length,
        cobreFoto: visivel && tr.top < im.bottom - 0.5,
        cobreControle: visivel && baixos.some((b) => b.bottom > tr.top + 0.5),
        alvoPequeno: minis.filter((x) => x.height < 44 || x.width < 44).length,
        // Comparar com as URLs do próprio lightbox é o que prova o reuso —
        // medir "requisições novas" não serve, porque `route` do Playwright
        // desliga o cache HTTP e TODA imagem aparece como pedido novo.
        reusa: [...tira.querySelectorAll('.lb-mini img')].every((x) => Lightbox.urls.includes(x.getAttribute('src'))),
        selos: tira.querySelectorAll('.lb-mini-selo').length,
      };
    }, [FIXTURES_PAISES.filter((p) => (p.imageUrls || []).length), nFotos]);
    const onde = `tira · ${aparelho} · ${nFotos} foto(s)`;
    if (nFotos === 1) {
      // Com uma foto só a tira é ruído: some, e o padding do contêiner some junto.
      checa(!m.visivel && !m.comTira, `${onde}: a tira apareceu com uma foto só`);
      continue;
    }
    checa(m.visivel && m.comTira, `${onde}: a tira NÃO apareceu`);
    checa(m.nMinis === nFotos, `${onde}: esperava ${nFotos} miniaturas, veio ${m.nMinis}`);
    checa(!m.cobreFoto, `${onde}: a tira cobre a FOTO — ela tem que entrar no layout, não flutuar`);
    checa(!m.cobreControle, `${onde}: a tira cobre a dica de zoom ou os botões de foto`);
    checa(m.alvoPequeno === 0, `${onde}: ${m.alvoPequeno} miniatura(s) com alvo < 44px`);
    checa(m.reusa, `${onde}: a tira pediu URL diferente da foto grande — perde o cache do aquecimento e baixa de novo o que já está no aparelho`);
    checa(m.selos === 1, `${onde}: o selo da foto do pedido sumiu da tira — sem ele são N fotos iguais`, String(m.selos));
  }
  checa(erros.length === 0, `tira · ${aparelho}: erro de JS`, erros[0]);
  await ctx.close();
}

// ── Idade da foto na pílula do lightbox ────────────────────────────────
// A pergunta que antecede a lixeira é "isto ainda é este lugar?", e MEDIDO nos
// 6 países obrigatórios (3176 fotos) 39,2% têm mais de 3 anos — hoje sem sinal
// nenhum na tela. A idade entra na pílula que já existe, sem custar espaço.
//
// Três coisas que quebram calado:
//   1. o campo mudar de nome no core (`date`, não `creationDate` — pela
//      tipagem do SDK sairia `undefined` em tudo e a pílula só sumiria);
//   2. a pílula sumir quando há UMA foto — aí a idade some junto, e é
//      justamente onde ela é a única informação;
//   3. plural errado: o projeto não tem ICU, e "há 1 dias" é o defeito clássico.
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'pt-BR', serviceWorkers: 'block' });
  await ctx.route('https://venue-image.waze.com/**', (r) => r.fulfill({ body: PX_TIRA, contentType: 'image/jpeg' }));
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.addInitScript(() => localStorage.setItem('waze_places_preferences',
    JSON.stringify({ undoEnabled: false, comoFuncionaVisto: true, undoGateSeen: true, dicaDesfazerVista: true })));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  // Idades tiradas da distribuição REAL: mediana 62 dias, p75 2350, máxima 4370.
  const casos = await page.evaluate(([fila]) => {
    const p = JSON.parse(JSON.stringify(fila[0]));
    const dia = 86400000, agora = Date.now();
    const idades = { f0: 0, f1: 1, f2: 62, f3: 2350 };
    p.imageUrls = Object.keys(idades).map((k) => `https://venue-image.waze.com/thumbs/thumb700_${k}`);
    p.imageDates = Object.fromEntries(Object.entries(idades).map(([k, d]) => [k, agora - d * dia]));
    p.venueID = 'v1'; p.updateRequestID = 'u1';
    API.setSession('token-de-teste'); AppState.authenticated = true;
    AppState.profile = { id: 1, userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
    AppState.serverTotal = 9; AppState.hasMore = false;
    AppState.queue = [p]; AppState.currentPlace = p;
    showMainScreen(); renderProfileHeader(); updateStats(); showLoading(false);
    document.getElementById('noMoreCards').classList.add('hidden'); showCurrentPlace();
    const pilula = document.getElementById('lightboxCount');
    const out = { varias: [], uma: null, semData: null };
    Lightbox.open(p.imageUrls, 0, -1, 'teste', false, p);
    for (let i = 0; i < 4; i++) {
      Lightbox.idx = i; Lightbox._render();
      out.varias.push({ txt: pilula.textContent, escondida: pilula.classList.contains('hidden'), title: pilula.title });
    }
    // uma foto só: some o "1 / 1", fica a idade
    const um = JSON.parse(JSON.stringify(p));
    um.imageUrls = [p.imageUrls[3]];
    Lightbox.close(); Lightbox.open(um.imageUrls, 0, -1, 'teste', false, um);
    out.uma = { txt: pilula.textContent, escondida: pilula.classList.contains('hidden') };
    // sem data nenhuma: a pílula volta a ser só o contador
    const sem = JSON.parse(JSON.stringify(p)); delete sem.imageDates;
    Lightbox.close(); Lightbox.open(sem.imageUrls, 0, -1, 'teste', false, sem);
    out.semData = { txt: pilula.textContent, escondida: pilula.classList.contains('hidden') };
    Lightbox.close();
    return out;
  }, [FIXTURES_PAISES.filter((x) => (x.imageUrls || []).length)]);

  const onde = 'idade da foto';
  casos.varias.forEach((c, i) => {
    checa(!c.escondida, `${onde}: a pílula sumiu na foto ${i + 1}`);
    checa(/\d+ \/ 4/.test(c.txt), `${onde}: sumiu o contador da pílula`, c.txt);
    checa(c.txt.includes('·'), `${onde}: a foto ${i + 1} está sem idade na pílula`, c.txt);
    checa(!/\bundefined\b|NaN|Invalid/.test(c.txt), `${onde}: idade inválida na tela`, c.txt);
    checa(!!c.title, `${onde}: sumiu a data exata do title`);
  });
  // 2350 dias tem que virar ANO, não "há 2350 dias" — foi por isso que o corte existe
  checa(/\b20\d\d\b/.test(casos.varias[3].txt), `${onde}: foto de 2350 dias não virou ano`, casos.varias[3].txt);
  // e 1 dia não pode sair "há 1 dias" (sem ICU no projeto)
  checa(!/\b1 dias\b/.test(casos.varias[1].txt), `${onde}: plural errado — "1 dias"`, casos.varias[1].txt);
  checa(!casos.uma.escondida && !/\//.test(casos.uma.txt), `${onde}: com UMA foto a pílula devia mostrar só a idade`, casos.uma.txt);
  checa(casos.semData.txt.includes('/') && !casos.semData.txt.includes('·'),
    `${onde}: sem data a pílula devia ser só o contador`, casos.semData.txt);
  checa(erros.length === 0, `${onde}: erro de JS`, erros[0]);
  await ctx.close();
}

// ── DUPLICATE: o card diz DE QUEM e mostra ONDE ────────────────────────────
//
// "Duplicado" sozinho é meia frase — o WME escreve "Duplicado DE <local>", e o
// alvo é justamente o que decide. O nome vem do core (`resolverDuplicados`,
// uma releitura por bbox), e aqui se mede o que a TELA faz com ele.
//
// Três casos, e o terceiro é o que costuma quebrar: nome longo no aparelho
// mais estreito, em francês — a frase francesa ainda soma « » por cima, e a
// linha do motivo é `flex-shrink-0`, então tudo o que ela crescer sai da
// barra ✕/↑/✓ (gotcha #45).
{
  const ALVO_ID = '205391388.2053651740.12920425';
  const CENTRO = [-23.5, -46.6], ALVO_LL = [-23.49914, -46.6];   // 96 m: a distância REAL do pedido
  const DUP_BASE = {
    venueID: '205391388.2053651740.4527272', updateRequestID: 'ur-dup',
    name: 'Estacionamento Times Park', categories: ['PARKING_LOT'],
    address: 'Rua Ministro Gabriel de Rezende Passos, 100 - Moema, São Paulo - São Paulo',
    updateTypeKey: 'FLAG', reqType: 'REQUEST', reqSubType: 'FLAG',
    createdBy: 'wazer', source: 'MOBILE_CLIENT', imageUrls: [], changes: [],
    flagType: 'DUPLICATE', flagSubjectType: 'VENUE', flagEntityID: ALVO_ID, flagComment: null,
    dateAdded: 1786982736809, lat: CENTRO[0], lon: CENTRO[1],
    mapa: { centro: CENTRO, proposto: null, movidoM: null, entradas: [] },
  };
  const DUP_CASOS = {
    comNome: { ...DUP_BASE, duplicado: { id: ALVO_ID, nome: 'Natan Estacionamento', ll: ALVO_LL, distM: 96 } },
    semNome: { ...DUP_BASE, duplicado: { id: ALVO_ID, nome: null, ll: ALVO_LL, distM: 96 } },
    nomeLongo: { ...DUP_BASE, duplicado: { id: ALVO_ID, ll: ALVO_LL, distM: 96,
      nome: 'Estacionamento Rotativo Municipal do Centro Histórico de São José do Rio Preto' } },
    naoResolvido: { ...DUP_BASE },
  };
  // Os MESMOS dois de `APARELHOS` que apertam a conta de altura — inventar
  // dimensão aqui é medir outro aparelho e achar que se mediu o do projeto.
  const APARELHOS_DUP = [['Galaxy Fold', { width: 280, height: 653 }], ['iPhone SE', { width: 375, height: 667 }]];
  // Margem da dobra por aparelho/caso: é ela que responde "quanto o recurso
  // custou", e é a pergunta que me impediria de culpar o recurso novo por um
  // defeito que já existia (gotcha #28).
  const margens = {};
  for (const [aparelho, viewport] of APARELHOS_DUP) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', locale: 'pt-BR' });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e.message || e)));
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    for (const lang of LINGUAS) {
      for (const [nome, place] of Object.entries(DUP_CASOS)) {
        const onde = `duplicado ${aparelho}/${lang}/${nome}`;
        await page.evaluate(({ pl, l }) => {
          setLang(l);
          AppState.preferences.comoFuncionaVisto = true;
          try { closeModal('comoFuncionaModal'); } catch {}
          AppState.authenticated = true;
          AppState.profile = { id: 1, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false };
          AppState.serverTotal = 40;
          document.getElementById('authScreen').classList.add('hidden');
          document.getElementById('appScreen').classList.remove('hidden');
          renderProfileHeader(AppState.profile); updateStats(); showLoading(false);
          document.getElementById('noMoreCards').classList.add('hidden');
          AppState.queue = [pl]; AppState.currentPlace = pl;
          showCurrentPlace();
        }, { pl: place, l: lang });
        // Medir DEPOIS de assentar, e não no mesmo `evaluate` do render: o
        // `.card-enter` ainda anima e o observer do mapa refaz o enquadramento,
        // então a caixa medida no mesmo quadro é a de antes de o card assentar.
        // Medido: 1,29px de sobra "abaixo da dobra" no SE que somem depois —
        // eu ia registrar como defeito da app o que era pressa do instrumento.
        await assentar(page);
        const m = await page.evaluate(() => {
          const c = document.querySelector('.place-card');
          if (!c) return null;
          const val = c.querySelector('.card-flag-reason-value');
          const barra = c.querySelector('.card-btn-reject')?.parentElement;
          const rb = barra ? barra.getBoundingClientRect() : null;
          return {
            motivo: val ? val.textContent : '',
            legenda: [...c.querySelectorAll('.card-map-legend .mapa-leg')].map((x) => x.textContent.trim()),
            marcaDup: !!c.querySelector('.card-map-marks .mapa-duplicado'),
            // Alvo do gesto: a barra tem que estar INTEIRA na tela.
            foraDaDobraCru: rb ? rb.bottom - innerHeight : null,
            foraDaDobra: rb ? Math.round(rb.bottom - innerHeight) : null,
            estouroH: Math.round(document.documentElement.scrollWidth - innerWidth),
          };
        });
        if (!m) { checa(false, `${onde}: sem card`); continue; }
        checa(m.estouroH <= 0, `${onde}: estouro horizontal`, `${m.estouroH}px`);
        checa(m.foraDaDobra <= 0, `${onde}: barra ✕/↑/✓ abaixo da dobra`, `${m.foraDaDobraCru}px`);
        checa(erros.length === 0, `${onde}: erro de JS`, erros[0]);
        if (nome === 'naoResolvido') {
          // Alvo que não resolve não pode deixar "de" pendurado nem marcador órfão.
          checa(!/[«“"]/.test(m.motivo), `${onde}: frase com aspas sem alvo`, m.motivo);
          checa(!m.marcaDup, `${onde}: marcador de duplicado sem alvo`);
        } else {
          checa(m.marcaDup, `${onde}: sem o marcador do duplicado no mapa`);
          checa(m.legenda.length >= 2, `${onde}: legenda não nomeia o marcador novo`, m.legenda.join('|'));
        }
        // Nome conhecido → a frase TEM que dizê-lo; sem nome → volta à forma
        // isolada, porque `de “(local sem nome)”` empilha aspas e parênteses.
        const temNome = DUP_CASOS[nome].duplicado && DUP_CASOS[nome].duplicado.nome;
        if (temNome) checa(m.motivo.includes(DUP_CASOS[nome].duplicado.nome), `${onde}: o motivo não nomeia o alvo`, m.motivo);
        else checa(!/[«“"]/.test(m.motivo), `${onde}: forma completa sem nome pra pôr`, m.motivo);
        checa(!/\{alvo\}/.test(m.motivo), `${onde}: {alvo} vazou cru pra tela`, m.motivo);
        margens[`${aparelho}/${lang}/${nome}`] = m.foraDaDobraCru;
      }
    }
    await ctx.close();
  }
  // CONTROLE: `naoResolvido` é o card de HOJE, sem nada do recurso. Se a margem
  // dele for igual à dos outros, o recurso custou zero pixel de dobra — e se um
  // dia der diferença, a diferença é do recurso, não da app. Sem esta conta eu
  // ia registrar como defeito da app um 1,29px que era o instrumento medindo
  // antes de o card assentar.
  for (const [aparelho] of APARELHOS_DUP) {
    for (const lang of LINGUAS) {
      const base = margens[`${aparelho}/${lang}/naoResolvido`];
      for (const nome of ['comNome', 'semNome', 'nomeLongo']) {
        const dif = margens[`${aparelho}/${lang}/${nome}`] - base;
        checa(Math.abs(dif) < 1, `duplicado ${aparelho}/${lang}/${nome}: custou ${dif.toFixed(2)}px de dobra sobre o card sem o recurso`);
      }
    }
  }
}

// ── Realce do miolo: o que a tela ESCONDE ──────────────────────────────────
//
// A regra de quando realçar está travada em `test/layout.test.mjs` (função
// pura, com casos reais). Aqui se mede o que só o browser responde: o realce
// SOBREVIVE ao `-webkit-line-clamp: 3` e tem contraste no pixel.
//
// As duas coisas já falharam de verdade nesta ordem: na primeira versão os
// marcadores saíam com `visivel=false` em TODOS os aparelhos estreitos, porque
// o clamp cortava o nome de 49 caracteres antes da diferença — o recurso ficava
// invisível justamente na tela onde ele mais serve. Daí a janela.
{
  const DIFF_LONGO = 'Aeroport Josep Tarradellas Barcelona - El Prat T';
  const CARD_REALCE = {
    venueID: 'r1', updateRequestID: 'ur1', name: 'Aeroport Josep Tarradellas Barcelona',
    categories: ['AIRPORT'], address: 'El Prat de Llobregat, Barcelona',
    updateTypeKey: 'UPDATE', reqType: 'REQUEST', reqSubType: 'UPDATE',
    createdBy: 'wazer', imageUrls: [], dateAdded: 1786982736809,
    lat: 41.29, lon: 2.07, mapa: { centro: [41.29, 2.07], proposto: null, movidoM: null, entradas: [] },
    changes: [
      // agulha em texto LONGO: é o caso que o clamp comia
      { field: 'name', label: 'Nome', from: DIFF_LONGO + '1', to: DIFF_LONGO + '2' },
      // agulha em texto CURTO: tem que passar inteiro, sem reticência
      { field: 'description', label: 'Descrição', from: 'CDG Terminal 2F', to: 'CDG Terminal 2C' },
      // ÓBVIO: nome trocado inteiro — não pode acender realce nenhum
      { field: 'phone', label: 'Telefone', from: 'Bom Atacarejo', to: 'Strapasson' },
    ],
  };
  for (const [aparelho, viewport] of [['Galaxy Fold', { width: 280, height: 653 }],
                                      ['Pixel 7', { width: 412, height: 915 }]]) {
    for (const tema of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', locale: 'pt-BR', colorScheme: tema });
      const page = await ctx.newPage();
      const erros = [];
      page.on('pageerror', (e) => erros.push(String(e.message || e)));
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(200);
      await page.evaluate((pl) => {
        AppState.preferences.comoFuncionaVisto = true;
        AppState.preferences.undoGateSeen = true;
        try { closeModal('comoFuncionaModal'); } catch {}
        AppState.authenticated = true;
        AppState.profile = { id: 1, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false };
        AppState.serverTotal = 9;
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.remove('hidden');
        renderProfileHeader(AppState.profile); updateStats(); showLoading(false);
        document.getElementById('noMoreCards').classList.add('hidden');
        AppState.queue = [pl]; AppState.currentPlace = pl; showCurrentPlace();
      }, CARD_REALCE);
      await assentar(page);
      const m = await page.evaluate(() => {
        const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
        // COMPÕE a cadeia de alfa até o primeiro fundo opaco. O `fundoDe` do
        // resto do smoke PARA no primeiro opaco, e no tema escuro o realce tem
        // alfa 0,3 — mediria contra o fundo errado (gotcha #40: constante de
        // contraste tem escopo, e o escopo é o pixel real).
        const fundoComposto = (el) => {
          const pilha = [];
          for (let n = el; n; n = n.parentElement) {
            const c = rgb(getComputedStyle(n).backgroundColor);
            if (c.length < 3) continue;
            const a = c[3] === undefined ? 1 : c[3];
            if (a > 0) pilha.push([c.slice(0, 3), a]);
            if (a >= 0.999) break;
          }
          let out = [255, 255, 255];
          for (let i = pilha.length - 1; i >= 0; i--) { const [c, a] = pilha[i]; out = out.map((v, k) => c[k] * a + v * (1 - a)); }
          return out;
        };
        const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const marks = [...document.querySelectorAll('.diff-mark')].map((e) => {
          const cs = getComputedStyle(e), fundo = fundoComposto(e);
          const [x, y] = [lum(rgb(cs.color).slice(0, 3)), lum(fundo)].sort((a, b) => b - a);
          const pai = e.parentElement.getBoundingClientRect(), r = e.getBoundingClientRect();
          return { txt: e.textContent, razao: (x + 0.05) / (y + 0.05),
                   visivel: r.width > 0 && r.height > 0 && r.bottom <= pai.bottom + 0.5 && r.top >= pai.top - 0.5 };
        });
        const linhas = [...document.querySelectorAll('.diff-row')];
        return { marks,
          // a linha do telefone (`Bom Atacarejo` → `Strapasson`) é a de controle
          semRealceNoObvio: !linhas[2] || !linhas[2].querySelector('.diff-mark'),
          temTitle: linhas.filter((l) => l.querySelector('.diff-mark'))
                          .every((l) => l.querySelector('.diff-from').title.length > 0),
          curtoInteiro: !!(linhas[1] && !/…/.test(linhas[1].textContent)),
          estouroH: document.documentElement.scrollWidth - innerWidth };
      });
      const onde = `realce ${aparelho}/${tema}`;
      checa(m.marks.length === 4, `${onde}: esperava 4 realces (2 linhas × 2 lados)`, String(m.marks.length));
      for (const k of m.marks) {
        checa(k.visivel, `${onde}: realce "${k.txt}" cortado pelo line-clamp — invisível justo onde serve`);
        checa(k.razao >= 4.5, `${onde}: contraste do realce "${k.txt}"`, `${k.razao.toFixed(2)}:1 < 4.5`);
      }
      checa(m.semRealceNoObvio, `${onde}: realçou o que se vê num relance`);
      checa(m.temTitle, `${onde}: valor completo sumiu do title da linha realçada`);
      checa(m.curtoInteiro, `${onde}: encurtou um valor que já cabia`);
      checa(m.estouroH <= 0, `${onde}: estouro horizontal`, `${m.estouroH}px`);
      checa(erros.length === 0, `${onde}: erro de JS`, erros[0]);
      await ctx.close();
    }
  }
}

// ── Renomear o local pelo lightbox ─────────────────────────────────────────
//
// A única escrita de dado de LOCAL da app. Três coisas só o browser responde:
// o portão, a janela do Desfazer medida pela REDE, e se o campo sobrevive ao
// teclado — que é DO SISTEMA e varia muito de altura, então aqui vão três.
//
// A altura do teclado é simulada pelo `--kb-inset`, o mesmo valor que o
// `setupKeyboardInset()` publica a partir da `visualViewport` em produção.
{
  const FOTO_FACHADA = 'data:image/svg+xml;base64,' + Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">'
    + '<rect width="900" height="1200" fill="#93c5fd"/>'
    + '<rect x="60" y="700" width="780" height="150" rx="10" fill="#0f766e"/>'
    + '<text x="450" y="790" font-family="DejaVu Sans" font-size="56" fill="#fff" text-anchor="middle">ODONTODENTE SORRISO</text>'
    + '</svg>').toString('base64');
  const PLACE_REN = {
    venueID: 'v-ren', updateRequestID: 'u-ren', name: 'Odontodente Consultório',
    categories: ['DOCTOR_CLINIC'], address: 'Rua das Flores, 250 - Salvador, Bahia',
    updateTypeKey: 'IMAGE', reqType: 'IMAGE', reqSubType: '', createdBy: 'wazer',
    // Card de FOTO num local que já existe no mapa — que é o caso real: pedido
    // de foto em local aprovado. O bloco do portão logo abaixo varia este campo
    // pros três estados, inclusive o ausente.
    localAprovado: true,
    imageUrls: [FOTO_FACHADA], approvedImageIds: [], imageDates: {},
    dateAdded: 1786982736809, lat: -12.892, lon: -38.32,
    mapa: { centro: [-12.892, -38.32], proposto: null, movidoM: null, entradas: [] }, changes: [],
  };
  const CARD_REALCE_PLACE = PLACE_REN;
  const montarRen = (pl, rank, am, treino) => {
    API.setSession('tok-smoke');
    AppState.preferences.comoFuncionaVisto = true;
    AppState.preferences.undoGateSeen = true;
    try { closeModal('comoFuncionaModal'); } catch {}
    AppState.authenticated = true;
    AppState.profile = { id: 1, userName: 'editor', rank, isAreaManager: am, isStaff: false };
    AppState.serverTotal = 9;
    Treino.ativo = !!treino;
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    renderProfileHeader(AppState.profile); updateStats(); showLoading(false);
    document.getElementById('noMoreCards').classList.add('hidden');
    AppState.queue = [pl]; AppState.currentPlace = pl; showCurrentPlace();
    Lightbox.open(pl.imageUrls, 0, 0, pl.name, false, pl);
  };

  for (const [aparelho, viewport] of [['Pixel 7', { width: 412, height: 915 }],
                                      ['Galaxy Fold', { width: 280, height: 653 }],
                                      ['SE 2016', { width: 320, height: 568 }]]) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', locale: 'pt-BR' });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e.message || e)));
    const posts = [];
    await page.route('**/api/**', async (route) => {
      const r = route.request();
      if (r.method() === 'POST') { try { posts.push(JSON.parse(r.postData() || '{}')); } catch { posts.push({}); } }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(250);
    const onde = `renomear ${aparelho}`;

    // ── PORTÃO: os três casos, e os dois negativos importam mais ────────────
    for (const [rot, rank, am, treino, esperado] of [
      ['L3+AM', 2, true, false, false],
      ['L6 sem área', 5, false, false, false],
      ['L6+AM no TREINO', 5, true, true, false],   // treino não escreve, nunca
      ['L6+AM', 5, true, false, true],
    ]) {
      await page.evaluate(new Function('a', '(' + montarRen.toString() + ')(a[0],a[1],a[2],a[3])'),
        [JSON.parse(JSON.stringify(PLACE_REN)), rank, am, treino]);
      await assentar(page);
      const visivel = await page.locator('#lightboxNome').isVisible();
      checa(visivel === esperado, `${onde}: portão errado para ${rot}`, `visível=${visivel}`);
    }

    // ── LOCAL QUE AINDA NÃO EXISTE NO MAPA: o renomear não pode aparecer ────
    //
    // O Waze RECUSA escrita de atributo em local não aprovado — medido com
    // controle contra o WME real: mesmo payload, mesma sessão, `approved:false`
    // → HTTP 406, `approved:true` → 200. E são 29% dos cards com nome nos 6
    // países obrigatórios (40% da fila do owner no Brasil), então oferecer ali
    // é o beco sem saída que a regra de interface proíbe: digitar o nome certo
    // e levar "Erro do Waze (HTTP 406)" em `errorCategory: unknown`.
    //
    // O caso POSITIVO vai junto de propósito: guard que só testa o negativo
    // passa igual se a pílula sumir de todo mundo.
    for (const [rot, localAprovado, esperado] of [
      ['local aprovado', true, true],
      ['local NÃO aprovado (pedido pendente)', false, false],
      ['campo AUSENTE (Waze mudou)', undefined, true],   // lado permissivo
    ]) {
      const pl = JSON.parse(JSON.stringify(PLACE_REN));
      if (localAprovado === undefined) delete pl.localAprovado; else pl.localAprovado = localAprovado;
      await page.evaluate(new Function('a', '(' + montarRen.toString() + ')(a[0],a[1],a[2],a[3])'),
        [pl, 5, true, false]);
      await assentar(page);
      const visivel = await page.locator('#lightboxNome').isVisible();
      checa(visivel === esperado, `${onde}: ${rot} — pílula ${visivel ? 'apareceu' : 'sumiu'} e deveria ${esperado ? 'aparecer' : 'sumir'}`);
    }

    // ── TODO controle do lightbox RECEBE o toque ───────────────────────────
    //
    // Guard de gotcha #26 ("feedback não pode cobrir o alvo que ainda precisa
    // ser tocado"), agora valendo pro lightbox inteiro. Nasceu de um defeito
    // que fui eu quem pôs: o contêiner da pílula do nome é largura cheia e mora
    // DEPOIS do botão de ação no DOM, então engolia o toque — `elementFromPoint`
    // no centro do ✓ devolvia `lightboxNome`, e o owner ficou sem conseguir
    // aprovar uma foto. Limitar o `max-width` do BOTÃO de dentro não adianta:
    // quem intercepta é a caixa de fora, invisível mas não transparente.
    //
    // Medir `getBoundingClientRect` não pega isso: os dois retângulos existem e
    // estão onde deviam. Só `elementFromPoint` responde QUEM recebe o dedo.
    {
      const alvos = await page.evaluate(() => {
        const out = [];
        for (const id of ['lightboxClose', 'lightboxApprove', 'lightboxDelete', 'lightboxNomeBtn']) {
          const e = document.getElementById(id);
          if (!e || e.classList.contains('hidden')) continue;
          const r = e.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          const q = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
          out.push({ id, ok: !!(q && q.closest && q.closest('#' + id)),
                     ladrao: q ? (q.id || (typeof q.className === 'string' ? q.className : q.tagName)) : 'nada' });
        }
        return out;
      });
      // EXIGIR o botão de ação no cenário. Sem isto o guard passa por AUSÊNCIA:
      // se o ✓/lixeira não estiver na tela, não há o que colidir e o teste dá
      // verde sem ter medido nada — foi exatamente o que aconteceu na primeira
      // versão dele.
      checa(alvos.some((a) => a.id === 'lightboxApprove' || a.id === 'lightboxDelete'),
        `${onde}: o cenário não tem botão de ação na tela — o guard de toque não mede nada assim`);
      checa(alvos.some((a) => a.id === 'lightboxNomeBtn'),
        `${onde}: a pílula do nome não está na tela — sem ela não há sobreposição pra detectar`);
      for (const a of alvos) {
        checa(a.ok, `${onde}: quem recebe o toque no centro de #${a.id} é "${a.ladrao}", não ele`);
      }
    }

    // ── O nome antigo aparece UMA VEZ, não duas ────────────────────────────
    // O owner viu duas: a pílula (que eu mandava esconder e o `.hidden` não
    // escondia — gotcha #27) e a linha "Antes:" que eu tinha posto embaixo. A
    // linha saiu; a pílula ficou, virando rótulo. Contar OCORRÊNCIAS na tela é
    // o que pega isso — checar `classList.contains('hidden')` diria que sumiu.
    await page.locator('#lightboxNomeBtn').click();
    await assentar(page);
    const rep = await page.evaluate((antigo) => {
      const vis = (e) => { const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; };
      let n = 0;
      for (const e of document.querySelectorAll('#lightboxNome *')) {
        if (!e.children.length && vis(e) && (e.textContent || '').trim().includes(antigo)) n++;
      }
      const btn = document.getElementById('lightboxNomeBtn');
      return { n, botaoMorto: btn.disabled, semLapis: btn.querySelector('.lb-nome-lapis').classList.contains('hidden') };
    }, 'Odontodente Consultório');
    checa(rep.n === 1, `${onde}: o nome antigo aparece ${rep.n}× na tela durante a edição`);
    checa(rep.botaoMorto, `${onde}: a pílula virou rótulo mas continua clicável`);
    checa(rep.semLapis, `${onde}: o lápis ficou num rótulo que não é mais botão`);
    // Com 2+ fotos a tira ENTRA no layout e empurra os controles de baixo. A
    // pílula tem `bottom` próprio (por causa do teclado), então precisa da
    // regra dela — sem isso ela cobria as miniaturas nos três aparelhos.
    await page.evaluate(() => { try { fecharEdicaoNome(); } catch {} });
    const tira = await page.evaluate((pl) => {
      const p = { ...pl, imageUrls: [pl.imageUrls[0], pl.imageUrls[0], pl.imageUrls[0]] };
      AppState.queue = [p]; AppState.currentPlace = p; showCurrentPlace();
      Lightbox.close(); Lightbox.open(p.imageUrls, 0, 0, p.name, false, p);
      const t = document.getElementById('lightboxStrip');
      const n = document.getElementById('lightboxNome');
      if (t.classList.contains('hidden')) return { pulou: true };
      const rt = t.getBoundingClientRect(), rn = n.getBoundingClientRect();
      return { cobre: !(rn.right < rt.left || rn.left > rt.right || rn.bottom < rt.top || rn.top > rt.bottom) };
    }, CARD_REALCE_PLACE);
    checa(tira.pulou || !tira.cobre, `${onde}: a pílula do nome cobre a tira de miniaturas`);
    // volta ao pedido de uma foto só pro resto do bloco
    await page.evaluate(new Function('a', '(' + montarRen.toString() + ')(a[0],a[1],a[2],a[3])'),
      [JSON.parse(JSON.stringify(PLACE_REN)), 5, true, false]);
    await assentar(page);
    await page.locator('#lightboxNomeBtn').click();
    await assentar(page);

    // ── TECLADO: três alturas, porque ele é do sistema e varia ──────────────
    // Alturas PROPORCIONAIS, não absolutas: teclado real ocupa ~40–50% da tela,
    // então 400px fixos são plausíveis num Pixel 7 e absurdos num SE 2016 (70%
    // da tela). Testar o absurdo mede o layout contra um caso que não existe.
    // 60% é o exagero deliberado — aí a foto encolhe até o piso e o que se cobra
    // é só o campo continuar alcançável.
    for (const pct of [0, 0.45, 0.6]) {
      const kb = Math.round(viewport.height * pct);
      const m = await page.evaluate((px) => {
        document.documentElement.style.setProperty('--kb-inset', px + 'px');
        const r = (el) => el.getBoundingClientRect();
        const inp = document.getElementById('lightboxNomeInput');
        const ok = document.getElementById('lightboxNomeOk');
        const foto = document.getElementById('lightboxImage');
        const livre = innerHeight - px;                 // o que o teclado deixa
        const limite = Math.min(r(inp).top, livre);
        // A FOTO RENDERIZADA, não a caixa da <img>: com `object-contain` a caixa
        // é a do contêiner e sobra tarja. Medir a caixa diria "a placa está
        // visível" com ela dentro da tarja — o mesmo erro de instrumento que já
        // apareceu no tile do mapa (gotcha #58) e no realce do miolo.
        const el = r(foto);
        const escala = Math.min(el.width / foto.naturalWidth, el.height / foto.naturalHeight);
        const alt = foto.naturalHeight * escala;
        const topo = el.top + (el.height - alt) / 2;
        return {
          campo: r(inp).bottom <= livre + 0.5 && r(inp).top >= 0,
          okAlvo: Math.round(r(ok).height),
          // a PLACA da fachada fica a 58%–71% da altura da FOTO: é ela a prova
          placa: topo + alt * 0.71 <= limite && topo + alt * 0.58 >= 0,
          _placaDbg: `foto ${Math.round(topo)}..${Math.round(topo + alt)} placa ${Math.round(topo + alt * 0.58)}..${Math.round(topo + alt * 0.71)} limite ${Math.round(limite)}`,
          estouroH: document.documentElement.scrollWidth - innerWidth,
          _dbg: `viewport=${innerHeight} livre=${livre} campo.top=${Math.round(r(inp).top)} campo.bottom=${Math.round(r(inp).bottom)}`,
        };
      }, kb);
      checa(m.campo, `${onde}: campo atrás do teclado de ${kb}px`, m._dbg);
      checa(m.okAlvo >= 44, `${onde}: alvo do Salvar com teclado ${kb}px`, `${m.okAlvo}px`);
      // Com teclado de 60% não sobra tela pra foto em aparelho nenhum — ali o
      // que se cobra é o campo, e a pessoa fecha o teclado pra rever a fachada.
      if (pct <= 0.45) checa(m.placa, `${onde}: a placa da fachada — a PROVA do nome — sumiu com teclado ${kb}px`, m._placaDbg);
      checa(m.estouroH <= 0, `${onde}: estouro horizontal com teclado ${kb}px`, `${m.estouroH}px`);
    }
    await page.evaluate(() => document.documentElement.style.setProperty('--kb-inset', '0px'));

    // ── ENVIO: medido pela REDE, não pelo DOM ───────────────────────────────
    await page.locator('#lightboxNomeInput').fill('Odontodente Sorriso');
    posts.length = 0;
    await page.locator('#lightboxNomeOk').click();
    await page.waitForTimeout(400);
    checa(posts.length === 0, `${onde}: gravou ANTES de a janela do Desfazer vencer`);
    await page.waitForTimeout(UNDO_ESPERA_MS);
    const env = posts.find((p) => p && p.venueID);
    checa(!!env, `${onde}: o POST não saiu depois da janela`);
    checa(!!env && env.nome === 'Odontodente Sorriso' && env.venueID === 'v-ren',
      `${onde}: payload errado`, JSON.stringify(env && { v: env.venueID, n: env.nome }));

    // ── DESFAZER: nada chega ao Waze e o nome volta ─────────────────────────
    await page.evaluate(new Function('a', '(' + montarRen.toString() + ')(a[0],a[1],a[2],a[3])'),
      [JSON.parse(JSON.stringify(PLACE_REN)), 5, true, false]);
    await assentar(page);
    await page.locator('#lightboxNomeBtn').click();
    await page.locator('#lightboxNomeInput').fill('Nome Desfeito');
    posts.length = 0;
    await page.locator('#lightboxNomeOk').click();
    await page.waitForTimeout(300);
    await page.locator('#undoContainer button').first().click();
    await page.waitForTimeout(UNDO_ESPERA_MS);
    checa(posts.filter((p) => p && p.venueID).length === 0, `${onde}: Desfazer não impediu a gravação`);
    const voltou = await page.locator('#lightboxNomeTxt').textContent();
    checa(voltou === 'Odontodente Consultório', `${onde}: o nome não voltou ao original`, voltou);
    checa(erros.length === 0, `${onde}: erro de JS`, erros[0]);
    await ctx.close();
  }
}


// ── A faixa do carrossel não pode roubar o toque do slide atrás ─────────────
// Terceira reincidência do gotcha #26. A faixa `.card-image-nav` tem largura
// cheia e 44px de altura; num aparelho ESTREITO o mini-mapa fica com ~100px, a
// faixa atravessa o meio dele e o VAZIO entre as setas comia o toque — o mapa
// ampliado não abria pelo centro. No Pixel 7 (mapa de 144px) o centro escapa,
// e é por isso que só se vê na tela estreita: medir num aparelho só não pega.
{
  const APS = [['Galaxy Fold', { width: 280, height: 653 }], ['Pixel 7', { width: 412, height: 915 }]];
  for (const [ap, viewport] of APS) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', locale: 'pt-BR' });
    const page = await ctx.newPage();
    await page.addInitScript(() =>
      localStorage.setItem('waze_places_preferences', JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true })));
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(450);
    await page.evaluate((pl) => {
      AppState.authenticated = true;
      AppState.profile = { username: 'ed', rank: 5, isAreaManager: true, isStaff: false, areas: [] };
      document.getElementById('authScreen').classList.add('hidden');
      document.getElementById('appScreen').classList.remove('hidden');
      AppState.queue = [pl]; AppState.currentPlace = pl; AppState.serverTotal = 1;
      showLoading(false); showCurrentPlace(); updatePendingCount();
    }, FIXTURES_PAISES.find((f) => f.mapa && f.mapa.centro && (f.imageUrls || []).length > 1)
        || FIXTURES_PAISES.find((f) => f.mapa && f.mapa.centro));
    await assentar(page, 400);
    const r = await page.evaluate(async () => {
      // O slide do mapa fica escondido ate se chegar nele pelo carrossel --
      // e a navegacao usa a MESMA seta que o guard vai testar.
      const prox = document.querySelector('.card-image-next');
      for (let i = 0; i < 8 && document.querySelector('.card-map.hidden'); i++) {
        if (!prox) break;
        prox.click();
        await dormir(90);
      }
      const m = document.querySelector('.card-map');
      if (!m || m.classList.contains('hidden')) return { semMapa: true };
      const q = m.getBoundingClientRect();
      if (q.height < 1) return { semMapa: true };
      // O CENTRO do mapa, que é onde o dedo cai pra ampliar.
      const t = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      const nav = document.querySelector('.card-image-nav');
      return {
        semMapa: false,
        recebe: !!(t && (t === m || m.contains(t))),
        ladrao: t ? (t.className || t.tagName).toString().slice(0, 40) : null,
        alturaMapa: Math.round(q.height),
        navPassa: nav ? getComputedStyle(nav).pointerEvents === 'none' : null,
        setasAtivas: [...document.querySelectorAll('.card-image-prev, .card-image-next')]
          .every((b) => getComputedStyle(b).pointerEvents !== 'none'),
      };
    });
    const onde = `faixa do carrossel/${ap}`;
    // Guard que passa por AUSÊNCIA não é guard: exija o mapa na tela.
    checa(!r.semMapa, `${onde}: o mapa não renderizou — o guard passaria por ausência`);
    if (r.semMapa) { await ctx.close(); continue; }
    checa(r.recebe, `${onde}: o centro do mapa (${r.alturaMapa}px de altura) não recebe o toque`, r.ladrao);
    checa(r.navPassa === true, `${onde}: .card-image-nav voltou a interceptar o toque`);
    checa(r.setasAtivas, `${onde}: as setas do carrossel ficaram inertes`);
    await ctx.close();
  }
}

// ── As abas de Filtros cabem em 44px nos QUATRO idiomas ────────────────────
// `1fr` é `minmax(auto, 1fr)`: a aba de rótulo mais longo empurra as vizinhas.
// Em francês "Préférences" espremia "Filtres" para 41px no Galaxy Fold — e em
// português não aparecia (gotcha #25). O conserto é corpo menor abaixo de
// 320px; a saída óbvia (minmax(0,1fr)) foi testada e é PIOR, porque iguala em
// 61px e CORTA o rótulo. Por isso o guard cobra as DUAS coisas: alvo ≥ 44 e
// texto que não transborda.
{
  for (const [ap, viewport] of [['Galaxy Fold', { width: 280, height: 653 }], ['iPhone SE', { width: 375, height: 667 }]]) {
    for (const lang of LINGUAS) {
      const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', locale: lang === 'en' ? 'en-US' : lang });
      const page = await ctx.newPage();
      await page.addInitScript((l) => {
        localStorage.setItem('waze_places_lang', l);
        localStorage.setItem('waze_places_preferences', JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true }));
      }, lang);
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(450);
      await page.evaluate(() => { AppState.authenticated = true; openModal('filtersModal'); });
      await assentar(page, 200);
      const abas = await page.evaluate(() => [...document.querySelectorAll('.seg-tab')].map((e) => {
        const q = e.getBoundingClientRect();
        return {
          txt: (e.textContent || '').trim(),
          w: Math.round(q.width), h: Math.round(q.height),
          // O que a TELA deu não basta: rótulo cortado não se lê.
          vaza: e.scrollWidth > e.clientWidth + 1,
        };
      }));
      const onde = `abas de Filtros/${ap}/${lang}`;
      checa(abas.length === 3, `${onde}: esperava 3 abas`, String(abas.length));
      for (const a of abas) {
        checa(a.w >= 44 && a.h >= 44, `${onde}: "${a.txt}" com alvo ${a.w}x${a.h} (mín. 44)`);
        checa(!a.vaza, `${onde}: "${a.txt}" com o rótulo cortado`);
      }
      await ctx.close();
    }
  }
}


// ── Renomeando: as acoes de foto SOMEM, e as setas sao do CURSOR ───────────
// DOIS relatos do owner, mesma tela e mesma familia de falha (regra de estado
// escrita em dois lugares, o segundo desfazendo o primeiro):
//
//   1. abrir a renomeacao escondia excluir/aprovar UMA vez; a proxima troca de
//      foto os reacendia, logo ABAIXO do confirmar/cancelar do nome -- o canto
//      pra onde o dedo ja estava indo, com duas acoes que gravam no mapa.
//   2. com o foco no campo, as setas TROCAVAM A FOTO e o preventDefault ainda
//      matava o movimento do cursor. A guarda de campo de texto existia, mas
//      DEPOIS do bloco do lightbox, que retorna antes de chegar nela.
//
// O guard cobre os dois E o CONTROLE de cada um: sem o controle, "some" passaria
// por um botao que nunca apareceu e "nao troca" por um carrossel de uma foto so.
{
  const pl = (() => {
    // Precisa de NOME (so corrige nome existente), local APROVADO (o Waze recusa
    // escrita em nao-aprovado) e a foto NOVA no indice 0, que e a que da acao.
    const b = FIXTURES_PAISES.find((f) => f.name) || {};
    return { ...b, name: b.name || 'Padaria do Ze', localAprovado: true,
             imageUrl: foto, imageUrls: [foto, foto, foto],
             approvedImageIds: [], imageDates: {} };
  })();

  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block', locale: 'pt-BR' });
  const page = await ctx.newPage();
  const errosR = [];
  page.on('pageerror', (e) => errosR.push(String(e).slice(0, 120)));
  await page.addInitScript(() => localStorage.setItem('waze_places_preferences',
    JSON.stringify({ undoEnabled: false, comoFuncionaVisto: true, undoGateSeen: true })));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(450);
  await page.evaluate((x) => {
    AppState.authenticated = true;
    AppState.profile = { userName: 'a', rank: 5, isAreaManager: true, isStaff: false, areas: [] };
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    AppState.queue = [x]; AppState.currentPlace = x; AppState.serverTotal = 1;
    showLoading(false); showCurrentPlace(); updatePendingCount();
  }, pl);
  await assentar(page, 300);
  await page.evaluate((x) => Lightbox.open(x.imageUrls, 0, 0, x.name, false, x), pl);
  await assentar(page, 250);

  const ler = () => page.evaluate(() => ({
    editando: !!document.getElementById('lightboxNome')?.classList.contains('editando'),
    del: !document.getElementById('lightboxDelete')?.classList.contains('hidden'),
    apr: !document.getElementById('lightboxApprove')?.classList.contains('hidden'),
    idx: Lightbox.idx,
    cursor: document.getElementById('lightboxNomeInput')?.selectionStart ?? null,
  }));

  const onde = 'renomear no lightbox';
  const a0 = await ler();
  // CONTROLE do relato 1: o botao TEM que estar visivel antes, senao "some"
  // passaria por ausencia -- guard que nunca viu o alvo nao guarda nada.
  checa(a0.apr, `${onde}: controle falhou — aprovar nao aparece nem ANTES de renomear`);

  await page.evaluate(() => abrirEdicaoNome());
  await assentar(page, 200);
  const a1 = await ler();
  checa(a1.editando, `${onde}: a renomeacao nao abriu`);
  checa(!a1.del && !a1.apr, `${onde}: acao de foto visivel ao ABRIR a renomeacao`);

  // O caso do relato: trocar de foto e VOLTAR pra que tem acao.
  await page.evaluate(() => Lightbox.next());
  await assentar(page, 150);
  await page.evaluate(() => Lightbox.prev());
  await assentar(page, 150);
  const a2 = await ler();
  checa(a2.idx === 0, `${onde}: controle falhou — a foto nao voltou pro indice 0`, String(a2.idx));
  checa(!a2.del && !a2.apr,
    `${onde}: acao de foto REAPARECEU ao trocar de foto durante a renomeacao`);

  // Relato 2: com o foco no campo, a seta e do cursor.
  await page.evaluate(() => {
    const i = document.getElementById('lightboxNomeInput');
    i.focus(); i.setSelectionRange(5, 5);
  });
  const b0 = await ler();
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(120);
  const b1 = await ler();
  checa(b1.idx === b0.idx, `${onde}: ArrowLeft com o foco no campo TROCOU a foto`, `${b0.idx} -> ${b1.idx}`);
  checa(b1.cursor === b0.cursor - 1, `${onde}: ArrowLeft nao andou o cursor`, `${b0.cursor} -> ${b1.cursor}`);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  const b2 = await ler();
  checa(b2.idx === b0.idx, `${onde}: ArrowRight com o foco no campo TROCOU a foto`, `${b1.idx} -> ${b2.idx}`);
  checa(b2.cursor === b0.cursor, `${onde}: ArrowRight nao andou o cursor`, `${b1.cursor} -> ${b2.cursor}`);

  // CONTROLE do relato 2: SEM campo focado, a seta tem que trocar a foto.
  // Sem isto o guard passaria com o teclado morto no lightbox inteiro.
  await page.evaluate(() => fecharEdicaoNome());
  await assentar(page, 200);
  await page.evaluate(() => document.getElementById('lightboxClose').focus());
  const c0 = await ler();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  const c1 = await ler();
  checa(c1.idx === c0.idx + 1,
    `${onde}: controle falhou — sem campo focado a seta deixou de trocar a foto`, `${c0.idx} -> ${c1.idx}`);

  // E ao fechar a renomeacao as acoes VOLTAM (some != some pra sempre).
  await page.evaluate(() => Lightbox.prev());
  await assentar(page, 200);
  const d0 = await ler();
  checa(d0.apr, `${onde}: a acao de foto nao voltou depois de fechar a renomeacao`);

  checa(errosR.length === 0, `${onde}: erro de JS`, errosR[0]);
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
  + `, + lixeira do lightbox (portão L6+AM, alvo, foto pendente e a janela de Desfazer)`
  + `, + aprovar foto nova (exclusividade com a lixeira, portão com staff, envio só ao fim da janela e approve=true)`
  + `, + sessão morta leva pra tela de entrar e oscilação de rede NÃO derruba`
  + `, + tile desenhado no tamanho pedido (card e ampliado, com stub DIFERENTE por x/y)`
  + `, + aquecimento dos próximos cards medido pela REDE (profundidade, largura e prioridade)`
  + `, + primeira execução ("Como funciona" uma vez só, scrim cobrindo o card, Esc sem sair da app, e o "Já instalei" que recarrega)`
  + `, + modo treino × ${LINGUAS.length} idiomas com a trava medida pela REDE (botão, tecla e gesto, com a janela do Desfazer vencida)`
  + `, + layout do treino em ${APARELHOS_TREINO.length} aparelhos × ${LINGUAS.length} idiomas (sobreposição, dobra, alvo e alcance)`
  + `, + treino com fila REAL × ${LINGUAS.length} idiomas: foto, lote e card mortos, com contraprova de que a lixeira EXISTE fora do treino`
  + `, + controles do cabeçalho CLICADOS (atualizar, filtros, tema, ajuda) exigindo zero erro de JS`
  + `, + ponto no ícone (ponto e nunca número, limpa ao zerar e ao sair, sem pedir permissão, e sem quebrar onde não há suporte)`
  + `, + aviso de sessão vencendo em 2 aparelhos × ${LINGUAS.length} idiomas (7 prazos, contraste composto, não vira alvo de toque e some no "Sair")`
  + `, + treino em 5 tamanhos de fila (contador = cards, teto de 30, piso de 3, todo card inerte e variedade na frente)`
  + `, + foto de perfil medida pela REDE: não sai antes da tela pronta, mas SAI depois (com fila e com fila vazia)`
  + `, + CSP sem violação e o tema inline EXECUTANDO nos dois esquemas (hash defasado bloqueia em silêncio)`
  + `, + tira de miniaturas do lightbox em 3 aparelhos apertados (entra no layout sem cobrir foto nem controle, alvo 44px, e reusando a URL já em cache)`
  + `, + idade da foto na pílula (relativo até 1 ano, ano depois, plural certo, e some quando não há data)`
  + `, + DUPLICATE em 2 aparelhos apertados × ${LINGUAS.length} idiomas (nomeia o alvo, marca no mapa, volta à forma isolada sem nome, e nome longo sem empurrar a barra)`
  + `, + realce do miolo em 2 aparelhos × 2 temas (sobrevive ao line-clamp, contraste no pixel composto, cala no óbvio e guarda o valor inteiro no title)`
  + `, + renomeando: ação de foto some (e VOLTA) e as setas são do cursor, com controle dos dois lados`
  + `, + faixa do carrossel não rouba o toque do mapa (2 aparelhos, com o mapa EXIGIDO na tela)`
  + `, + abas de Filtros em 2 aparelhos × ${LINGUAS.length} idiomas (alvo 44px E rótulo sem corte)`
  + `, + renomear pelo lightbox em 3 aparelhos (portão L6+AM com treino barrado, 3 alturas de teclado sem cobrir campo nem a placa da fachada, e envio medido pela REDE com Desfazer impedindo)`);
