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

import { subirServidorLocal } from './servidor-local.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as dormir } from 'node:timers/promises';
import { esperarFimDaSaida, esperarNaPagina, esperarOuExplodir } from './esperar-saida.mjs';
import { carregarPlaywright, abrirNavegador, motorPedido, pularForaDoChromium, resumoDosPulos, ruidoDoMotor } from './navegador.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.SMOKE_PORT || 8123);
const BASE = `http://127.0.0.1:${PORTA}/`;

// TIMER DE PÁGINA EM SEGUNDO PLANO É ESTRANGULADO, e isso derruba teste que
// avança por `setTimeout` em cadeia. HIPÓTESE, não medição: o bloco da fila de
// saída reprovou DUAS vezes no CI parando sempre depois de 1–2 itens — e ele
// avança 400ms por item —, sem reproduzir aqui nem com CPU 8× mais lenta. O
// runner abre muitos contextos e a página pode ficar em segundo plano; nessa
// condição o Chromium adia timers agressivamente e 8 itens não cabem na janela
// de 40s do teste. Os três flags são o desligamento padrão disso e não afrouxam
// asserção nenhuma. Se a próxima rodada continuar vermelha, o diagnóstico que
// o bloco agora imprime diz o motivo real — é ele, e não estes flags, que
// fecha a questão.
const ARGS_SEM_ESTRANGULAR = [
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

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
    // ⭐ AQUI, e não num card novo: o selo divide a linha do nome com o ↗ de
    // 44px, então o pior caso é o nome MAIS LONGO — que é este. Card à parte
    // custaria +17% no trecho mais lento do CI pra medir um caso mais folgado.
    //
    // A incidência real é baixa (MEDIDO com os cookies do owner: 2 em 500 na
    // fila do Brasil, 0,4%), e é justamente por isso que a fixture existe: o
    // caminho `place.isStarred → .card-starred` nunca tinha sido renderizado
    // por teste nenhum, e as 51 fixtures dos 6 países têm `isStarred: false`
    // em 51. Gotcha #52 — a fixture define o que o teste é capaz de enxergar.
    isStarred: true,
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
      // mais nada, que lê como app quebrado. Vira `(vazio)` com
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
  // e o deitado (393px de altura pro app inteiro).
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
// O caso que originou: o card entrava com um fade de `opacity` (hoje ele nasce
// sem efeito nenhum), e a verificação de contraste multiplica a opacidade de
// TODOS os ancestrais — medir no meio da animação dava uma cor mais misturada
// com o fundo e um contraste MENOR que o real. Com 350ms fixos isso passava
// aqui e reprovava no CI, onde o runner é mais lento e a animação começa
// tarde: `valor-ausente 4.08:1` contra os 4.84:1 medidos na mesma tela
// localmente.
//
// A entrada do card saiu, mas a espera FICA, e não por precaução vaga: o
// esqueleto, o confete, o selo do arraste e o observer do mapa seguem
// animando, e o próximo efeito que alguém adicionar não vai vir avisar.
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

// Espera por QUADRO, não por relógio: dois `requestAnimationFrame` garantem que
// todo quadro pedido ANTES — como o do FAB, que se reposiciona no primeiro
// quadro depois de a camada mudar — já rodou. MEDIDO no WebKit do Playwright,
// que desenha um quadro a cada ~100 ms: medindo 250 ms depois de abrir a Ajuda,
// o FAB ainda estava no canto velho, por cima do seletor de idioma, em 4 de 8
// rodadas; esperando os dois quadros, em 0 de 8 — com a CPU livre e ocupada.
// O app estava certo: o prazo é que media a velocidade do motor.
// O teto de 2 s é só pra não pendurar o smoke numa página sem quadro: se ele
// estourar, a medição segue e reprova pelo que vir — nunca passa por isso.
const doisQuadros = (page) => page.evaluate(() => new Promise((ok) => {
  setTimeout(ok, 2000);
  requestAnimationFrame(() => requestAnimationFrame(ok));
}));

const checa = (ok, msg, detalhe) => {
  if (!ok) { falhas++; console.log(`  ✗ ${msg}${detalhe ? ' — ' + detalhe : ''}`); }
};

// O servidor sobe por `tools/servidor-local.mjs`: porta LIVRE antes, e pronto
// é o próprio processo dizer que a ocupou (senão o smoke mediria o servidor de
// outro processo na mesma porta).
const { servidor } = await subirServidorLocal({ porta: PORTA, variavel: 'SMOKE_PORT' });

const pw = await carregarPlaywright();
const MOTOR = motorPedido();
const browser = await abrirNavegador(pw, { args: ARGS_SEM_ESTRANGULAR });

// O aviso "Como funciona" abre sozinho no PRIMEIRO card — que é exatamente o
// que todo bloco daqui renderiza. Sem suprimir, ele cobre o card com um scrim e
// os cliques dos outros testes batem nele (foi o que aconteceu: timeout no bloco
// do mapa ampliado). Suprimir aqui é o certo, não maquiagem: o assunto DELES é
// outro, e quem mede o aviso é o bloco próprio, que desliga esta supressão.
//
// Mora no `newContext` e não em cada chamada porque são ~20 contextos espalhados
// pelo arquivo: um esquecido daria falha intermitente e difícil de ligar à causa.
const _newContext = browser.newContext.bind(browser);
// A LISTA DA PRESENÇA sai no `showMainScreen` desde a fase 3. Com o token FALSO
// dos blocos daqui ela leva 401 de VERDADE do servidor, o `handleUnauthorized`
// confere com o `perfil` e, 1,2 s depois, a sessão cai (ou, com o `perfil`
// respondido, sai o aviso de alarme falso e a fila é buscada de novo). MEDIDO:
// 17 contextos em 6 blocos levavam esse 401. No avatar a sessão caía antes de
// a foto sair e o WebKit reprovou; nos outros o bloco terminava antes da
// conferência — num runner mais lento, mediria a tela de entrada (gotcha #62).
// `presencaViva` responde a lista como sessão viva, com ninguém mais no app.
// É ROTA, então só nos blocos que chamam a presença: rota desliga o cache HTTP
// do contexto, e 26 contextos daqui não têm rota nenhuma.
const presencaViva = (alvo) => alvo.route('**/api/presenca-app', (r) => r.fulfill({ status: 200,
  contentType: 'application/json', body: JSON.stringify({ success: true, online: [], conversas: [] }) }));
// A SENTINELA que impede a próxima vez de passar calada: um OUVINTE (não
// rota, o cache fica como está) em TODO contexto. Se a presença chegar ao
// servidor com a sessão falsa, o 401 dele (`srv.err.session…`) é anotado com a
// linha do bloco, e o fim do smoke reprova dizendo onde responder.
const presencaComSessaoFalsa = [];
browser.newContext = async (opts = {}) => {
  const { primeiraVez = false, ...resto } = opts;
  // A linha do BLOCO que criou o contexto: o 1º quadro deste arquivo fora
  // deste invólucro. Tirada antes do primeiro `await`, com o chamador na pilha.
  const linhas = (new Error().stack || '').split('\n')
    .map((l) => (l.match(/smoke-browser\.mjs:(\d+)/) || [])[1]).filter(Boolean);
  const bloco = linhas[1] || linhas[0] || '?';
  const ctx = await _newContext(resto);
  ctx.on('response', async (r) => {
    if (r.status() !== 401 || !/\/api\/(presenca-app|chat)(\?|$)/.test(r.url())) return;
    let chave = '';
    try { chave = String((await r.json()).errorKey || ''); } catch (e) { /* página fechou */ }
    if (chave.startsWith('srv.err.session')) presencaComSessaoFalsa.push(`linha ${bloco}`);
  });
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
        // A barra ✕/↑/✓ está NA TELA e recebe o toque? É a ação principal do
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
        // Contraste do que o app esmaece. `opacity` MISTURA a cor com o fundo,
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
          // O ⭐ do favoritado: existe, está VISÍVEL e cabe na linha do nome.
          // `offsetParent` e não `.hidden`, porque classe no DOM não prova
          // pixel na tela (gotcha #27: o styles.css pode vencer o `.hidden`).
          estrela: (() => {
            const e = c.querySelector('.card-starred');
            if (!e || !e.offsetParent) return null;
            const r = e.getBoundingClientRect();
            const linha = e.parentElement.getBoundingClientRect();
            const no = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
            return { largura: Math.round(r.width),
                     // Estourou a linha em que vive? Meia estrela cortada é o
                     // modo de falha esperado num Fold de 280px.
                     fora: Math.max(0, Math.round(r.right - linha.right), Math.round(linha.left - r.left)),
                     // Ele é decorativo e NÃO é alvo de toque, mas não pode
                     // ficar POR CIMA do ↗, que é (gotcha #26).
                     tapaOLink: !!(no && no.closest('.card-wme-link')) };
          })(),
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
      // O ⭐ aparece EXATAMENTE nos cards favoritados, e em nenhum outro. Sem as
      // duas metades a asserção é decoração: só a primeira passaria com o selo
      // preso em visível, só a segunda passaria com ele nunca aparecendo.
      checa(!!m.estrela === !!CARDS[tipo].isStarred,
        `${rot}: ⭐ no estado errado`, `visível=${!!m.estrela}, esperado=${!!CARDS[tipo].isStarred}`);
      if (m.estrela) {
        checa(m.estrela.fora === 0, `${rot}: ⭐ estourou a linha do nome`, `${m.estrela.fora}px`);
        checa(!m.estrela.tapaOLink, `${rot}: ⭐ está por cima do ↗ do WME`);
      }
      // Sem nome → selo visível. Com nome → selo escondido. Nunca os dois errados.
      checa(m.semNome === (tipo === 'SEM_NOME'), `${rot}: selo de "sem nome" no estado errado`, `selo=${m.semNome}`);
      // A página não pode estourar na horizontal.
      checa(m.estouroH <= 0, `${rot}: estouro horizontal de ${m.estouroH}px`);
      // Área que rola precisa de nome (leitor de tela).
      checa(m.roláveisSemNome === 0, `${rot}: ${m.roláveisSemNome} área(s) rolável(is) sem aria-label`);
      checa(m.comTetoFixo.length === 0, `${rot}: caixa longa com teto fixo em vez de flex`, m.comTetoFixo.join(', '));
      checa(m.contrasteBaixo.length === 0, `${rot}: texto esmaecido abaixo do contraste do WCAG`, m.contrasteBaixo.join(', '));
      // O app cabe na tela: card dimensionado pela SOBRA, não por fração da
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
      // O convite mora no "Tudo limpo!" de quem TERMINOU a fila (R6-7-11): a
      // pessoa tratou nesta fila e não sobrou pulado. Sem isto o painel é o de
      // "Confira o país e a região", e ali o convite não aparece mais.
      tratouNestaFila = true; puladosNoInicioDaFila = AppState.stats.skipped || 0;
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
  // R6-7-11: no painel de quem NÃO terminou a fila — o "Confira o país e a
  // região" (não tratou nada) e o "Fim da fila" (com pulados) — o convite não
  // aparece, nem quando o prompt do navegador chega depois. O "Tudo limpo!" de
  // cima é o CONTROLE: o mesmo painel, o mesmo convite podendo aparecer.
  const semFesta = await page.evaluate(() => {
    const visivel = () => !document.getElementById('installInvite').classList.contains('hidden');
    const out = {};
    tratouNestaFila = false; showNoPlaces(); atualizarConviteInstalar();
    out.nada = visivel();
    tratouNestaFila = true; AppState.stats.skipped = (AppState.stats.skipped || 0) + 2; showNoPlaces(); atualizarConviteInstalar();
    out.pulados = visivel();
    AppState.stats.skipped -= 2; showNoPlaces();
    out.tudoLimpo = visivel();
    return out;
  });
  checa(!semFesta.nada, `convite · ${nome}: apareceu no "Confira o país e a região" de quem não tratou nada`);
  checa(!semFesta.pulados, `convite · ${nome}: apareceu no "Fim da fila" com pulados pendentes`);
  checa(semFesta.tudoLimpo, `convite · ${nome}: CONTROLE — sumiu do "Tudo limpo!" de quem terminou`);
  // R6-7-12: "Agora não" pelo TECLADO esconde o convite com o foco nele — o
  // foco vai ao "Verificar novamente", que fica (caía no <body>). CONTROLE: o
  // mesmo botão pelo mouse não move o foco pra lá (a regra do app: só teclado).
  if (!iOS) {
    const foco = {};
    for (const via of ['teclado', 'mouse']) {
      await page.evaluate(() => { try { localStorage.removeItem('waze_places_install_dispensado'); } catch (e) {} showNoPlaces(); });
      const b = page.locator('#installDismissBtn');
      if (via === 'teclado') { await b.focus(); await page.keyboard.press('Enter'); } else { await b.click(); }
      await doisQuadros(page);
      foco[via] = await page.evaluate(() => ({ id: (document.activeElement && document.activeElement.id) || document.activeElement.tagName,
        convite: !document.getElementById('installInvite').classList.contains('hidden') }));
    }
    checa(!foco.teclado.convite && !foco.mouse.convite, `convite · ${nome}: PRÉ-CONDIÇÃO — o "Agora não" não escondeu o convite`, JSON.stringify(foco));
    checa(foco.teclado.id === 'reloadBtn', `convite · ${nome}: "Agora não" pelo teclado largou o foco em ${foco.teclado.id}`, JSON.stringify(foco));
    checa(foco.mouse.id !== 'reloadBtn', `convite · ${nome}: CONTROLE — o clique do mouse moveu o foco (o instrumento não distingue)`, JSON.stringify(foco));
  }
  await ctx.close();
}

// ── Convite no iPhone FORA do Safari (R13-7-03) ─────────────────────────────
// No Chrome, no Firefox e no Edge do iPhone (UA com CriOS, FxiOS, EdgiOS), o 1º
// passo mandava tocar "na barra do Safari" — um navegador que a pessoa não está
// usando; e antes do iOS 16.4 esses navegadores nem adicionam à Tela de Início,
// então o convite era um beco sem saída. A frase nova ("no menu do navegador")
// é medida nos 4 idiomas no Fold, no SE e no SE de 2016, LADO A LADO com a do
// Safari no mesmo tamanho e idioma: QUAL variante a tela mostra se lê pela CHAVE
// (`data-i18n-html`), nunca pelas palavras, e o texto na tela tem que ser o do
// dicionário DAQUELE idioma (a troca de idioma relê a chave). A frase não
// estoura a caixa nem parte palavra, o "Agora não" tem 44 px, e onde o convite
// do Safari cabe na tela o da frase nova também cabe. Onde o do Safari já NÃO
// cabia (o SE de 2016 em pt/es/fr, o Fold em fr: o "Agora não" fica 7 a 48 px
// abaixo da dobra, com o painel rolando — MEDIDO antes da frase nova, com o
// mesmo número nas duas variantes), a frase nova não desce o "Agora não" nem
// um pixel além do dele: mexer no layout do convite é mudança visual, e ficou
// pra decisão do owner. CONTROLES: o Safari do mesmo iOS segue com o passo da
// barra do Safari, e o Safari de um iOS antigo segue com o convite.
const UA_IOS = (marca, versao = '18_0') => `Mozilla/5.0 (iPhone; CPU iPhone OS ${versao} like Mac OS X) `
  + `AppleWebKit/605.1.15 (KHTML, like Gecko) ${marca} Mobile/15E148 Safari/604.1`;
const UA_SAFARI_IOS = (versao) => UA_IOS('Version/18.0', versao);
const UA_CHROME_IOS = (versao) => UA_IOS('CriOS/130.0.6723.90', versao);
const conviteNoIOS = async (vp, ua) => {
  const ctx = await browser.newContext({ viewport: vp, serviceWorkers: 'block', locale: 'pt-BR',
    isMobile: true, hasTouch: true, userAgent: ua });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  return { ctx, page };
};
const medirConviteIOS = (page, lang) => page.evaluate((lang) => {
  aplicarIdioma(lang);
  AppState.authenticated = true;
  AppState.profile = { id: 1, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false };
  AppState.stats = { read: 3, rejected: 1, skipped: 0 };
  AppState.serverTotal = 0;
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
  renderProfileHeader(AppState.profile); updateStats(); showLoading(false);
  AppState.queue = []; AppState.currentPlace = null;
  tratouNestaFila = true; puladosNoInicioDaFila = 0;
  showNoPlaces();
  const box = document.getElementById('installInvite');
  if (!box || box.classList.contains('hidden')) return { ausente: true };
  const passo = document.getElementById('installIosStep1');
  // A posição se mede com o painel no TOPO, onde ele aparece: onde o convite não
  // cabe, o painel rola, e uma rolagem que sobrou da medição anterior mudava o
  // número (no WebKit, 2 px entre as duas variantes iguais).
  document.getElementById('noMoreCards').scrollTop = 0;
  // Pros LADOS: nada do convite sai da largura da tela.
  const lados = [];
  for (const id of ['installIosSteps', 'installIosStep1', 'installDismissBtn']) {
    const e = document.getElementById(id);
    if (!e || e.classList.contains('hidden')) { lados.push(`${id} escondido`); continue; }
    const r = e.getBoundingClientRect();
    if (r.right > innerWidth + 1 || r.left < 0) lados.push(`${id} ${Math.round(r.left)}→${Math.round(r.right)}`);
  }
  // Palavra partida no meio (o Range de cada palavra em mais de uma linha).
  const partidas = [];
  const it = document.createTreeWalker(passo, NodeFilter.SHOW_TEXT); let n;
  while ((n = it.nextNode())) {
    const re = /\S{4,}/g; let x;
    while ((x = re.exec(n.nodeValue))) {
      const rg = document.createRange(); rg.setStart(n, x.index); rg.setEnd(n, x.index + x[0].length);
      if (new Set([...rg.getClientRects()].map((q) => Math.round(q.top))).size > 1) partidas.push(x[0]);
    }
  }
  const linhas = (() => { const rg = document.createRange(); rg.selectNodeContents(passo);
    return new Set([...rg.getClientRects()].map((q) => Math.round(q.top))).size; })();
  const dis = document.getElementById('installDismissBtn').getBoundingClientRect();
  return { chave: passo.getAttribute('data-i18n-html'), texto: passo.textContent.trim(),
    doDicionario: String((I18N_DICT[lang] || {})[passo.getAttribute('data-i18n-html')] || '').replace(/<[^>]+>/g, '').trim(),
    botao: !document.getElementById('installInviteBtn').classList.contains('hidden'),
    estouro: Math.max(0, passo.scrollWidth - passo.clientWidth), lados, partidas, linhas,
    fimDoDispensar: Math.round(dis.bottom), cabe: dis.bottom <= innerHeight + 1,
    alvoDispensar: Math.round(Math.min(dis.width, dis.height)) };
}, lang);
for (const [nome, vp] of [['Galaxy Fold', { width: 280, height: 653 }], ['iPhone SE', { width: 375, height: 667 }],
  ['SE 2016', { width: 320, height: 568 }]]) {
  const safari = await conviteNoIOS(vp, UA_SAFARI_IOS('18_0'));
  const chrome = await conviteNoIOS(vp, UA_CHROME_IOS('18_0'));
  for (const lang of LINGUAS) {
    const s = await medirConviteIOS(safari.page, lang);
    const m = await medirConviteIOS(chrome.page, lang);
    const rot = `convite fora do Safari · ${nome} · ${lang}`;
    checa(!s.ausente && s.chave === 'install.ios.step1', `${rot}: CONTROLE — o Safari perdeu o convite ou o passo da barra do Safari`,
      JSON.stringify({ ausente: s.ausente, chave: s.chave }));
    checa(!m.ausente, `${rot}: o convite sumiu do Chrome do iPhone (iOS 18), que adiciona à Tela de Início`);
    if (m.ausente || s.ausente) continue;
    checa(m.chave === 'install.ios.step1Navegador', `${rot}: o 1º passo segue mandando à barra do Safari`, m.chave);
    checa(m.texto === m.doDicionario && m.texto.length > 0, `${rot}: o texto na tela não é o do dicionário deste idioma`,
      `"${m.texto}" × "${m.doDicionario}"`);
    checa(!m.botao, `${rot}: botão de instalar no iPhone, que não tem o prompt`);
    checa(m.lados.length === 0, `${rot}: o convite sai pelos lados da tela`, m.lados.join(', '));
    checa(m.estouro === 0, `${rot}: a frase estoura a caixa`, `${m.estouro}px`);
    checa(m.partidas.length === 0, `${rot}: palavra partida no meio`, m.partidas.join(','));
    checa(m.linhas <= 2, `${rot}: a frase passou de duas linhas`, `${m.linhas} linhas`);
    checa(m.alvoDispensar >= 44, `${rot}: "Agora não" abaixo de 44px`, `${m.alvoDispensar}px`);
    checa(m.cabe || !s.cabe, `${rot}: o "Agora não" saiu da tela, e com a frase do Safari ele cabe`,
      `termina em ${m.fimDoDispensar} × ${s.fimDoDispensar} (Safari), tela ${vp.height}`);
    checa(m.cabe || m.fimDoDispensar <= s.fimDoDispensar, `${rot}: a frase nova desceu o "Agora não" além do que a do Safari já descia`,
      `termina em ${m.fimDoDispensar} × ${s.fimDoDispensar} (Safari), tela ${vp.height}`);
  }
  await safari.ctx.close();
  await chrome.ctx.close();
}
// O PULO do contador do placar (`.count-pop`) não mexe na ALTURA do placar —
// MEDIDO no lote 18: o `display: inline-block` que a regra punha no número (um
// `<p>`, caixa de BLOCO, onde o `transform` já vale) o trocava de bloco pra
// linha, e o alinhamento pela linha de base crescia a célula enquanto a animação
// corria. Abaixo de 360 px (o placar em 2×2: SE de 2016, Galaxy Fold) o placar
// crescia 2 px e EMPURRAVA o card 2 px pra baixo por 0,32 s a CADA decisão — e o
// bloco do convite acima reprovava sob carga (o "Agora não" 4 px mais baixo numa
// das duas páginas, medida no meio do pulo da outra). CONTROLE: o instrumento vê
// a classe no meio do pulo, e a CONTRAPROVA põe o `inline-block` de volta à mão e
// precisa ver a altura mudar (senão a medida é cega).
for (const [nome, vp] of [['SE 2016', { width: 320, height: 568 }], ['Galaxy Fold', { width: 280, height: 653 }],
  ['Pixel', { width: 412, height: 915 }]]) {
  const ctx = await browser.newContext({ viewport: vp, serviceWorkers: 'block', locale: 'pt-BR' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const m = await page.evaluate(async () => {
    const quadro = () => new Promise((r) => requestAnimationFrame(() => r()));
    AppState.authenticated = true;
    AppState.profile = { id: 1, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false };
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    renderProfileHeader(AppState.profile); showLoading(false);
    AppState.stats = { read: 3, rejected: 1, skipped: 0 }; updateStats(true);
    await quadro(); await quadro();
    const el = document.getElementById('rejectedCount');
    const alt = () => document.getElementById('placar').getBoundingClientRect().height;
    const topo = () => document.getElementById('cardStack').getBoundingClientRect().top;
    const antes = { placar: alt(), pilha: topo() };
    AppState.stats.rejected += 1; updateStats();
    await quadro();
    const durante = { placar: alt(), pilha: topo(), classe: el.classList.contains('count-pop') };
    // CONTRAPROVA: o `inline-block` de antes, à mão, no mesmo número.
    el.style.display = 'inline-block';
    const comInline = alt();
    el.style.display = '';
    return { antes, durante, comInline };
  });
  const rot = `pulo do contador · ${nome}`;
  checa(m.durante.classe, `${rot}: CONTROLE — a medida não pegou o número no meio do pulo`, JSON.stringify(m));
  checa(Math.abs(m.durante.placar - m.antes.placar) < 0.5 && Math.abs(m.durante.pilha - m.antes.pilha) < 0.5,
    `${rot}: o pulo do contador mudou a altura do placar e empurrou o card`,
    `placar ${m.antes.placar} → ${m.durante.placar}, card ${m.antes.pilha} → ${m.durante.pilha}`);
  if (vp.width < 360) checa(Math.abs(m.comInline - m.antes.placar) >= 0.5,
    `${rot}: CONTRAPROVA — com o inline-block de volta a altura não mudou, a medida é cega`, JSON.stringify(m));
  await ctx.close();
}
{
  // Antes do iOS 16.4: os navegadores de fora não adicionam — o convite não aparece.
  const se = { width: 375, height: 667 };
  for (const [marca, versao] of [['CriOS/130.0.6723.90', '16_3'], ['FxiOS/132.0', '15_7'], ['EdgiOS/130.0.2849.80', '16_0']]) {
    const { ctx, page } = await conviteNoIOS(se, UA_IOS(marca, versao));
    const m = await medirConviteIOS(page, 'pt');
    checa(m.ausente, `convite fora do Safari · iOS ${versao} · ${marca.split('/')[0]}: o convite apareceu onde não há "Adicionar à Tela de Início"`);
    await ctx.close();
  }
  // CONTROLE: o Safari de um iOS antigo segue com o convite e o passo dele.
  const { ctx, page } = await conviteNoIOS(se, UA_SAFARI_IOS('16_3'));
  const m = await medirConviteIOS(page, 'fr');
  checa(!m.ausente && m.chave === 'install.ios.step1', 'convite · Safari do iOS 16.3: CONTROLE — perdeu o convite ou o passo da barra do Safari',
    JSON.stringify({ ausente: m.ausente, chave: m.chave }));
  await ctx.close();
  // R14-7-A2: os OUTROS navegadores do iPhone e os de DENTRO de apps. O Safari se
  // reconhece pela POSITIVA (`Version/` e `Safari/`, sem marca de outro): o
  // Opera, o DuckDuckGo e o app do Google ganham o passo do menu do navegador (e
  // nenhum convite antes do iOS 16.4); dentro do Facebook e do Instagram (sem
  // `Safari/` na UA) e do Snapchat ("like Safari/"), nenhum convite — ali não há
  // "Adicionar à Tela de Início". As UAs são as que cada um PUBLICA:
  // conhecimento da plataforma, não medição (não há iPhone aqui).
  const IOS = (v) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)`;
  for (const [nome, ua, vale] of [
    ['Opera', IOS('18_0') + ' Version/18.0 Mobile/15E148 Safari/604.1 OPT/5.2.0', 'install.ios.step1Navegador'],
    ['DuckDuckGo', IOS('18_0') + ' Version/18.0 Mobile/15E148 Ddg/18.0 Safari/604.1', 'install.ios.step1Navegador'],
    ['app do Google', IOS('18_0') + ' GSA/380.0.773383853 Mobile/15E148 Safari/604.1', 'install.ios.step1Navegador'],
    ['Opera do iOS 16.3', IOS('16_3') + ' Version/16.3 Mobile/15E148 Safari/604.1 OPT/3.4.6', null],
    ['Facebook por dentro', IOS('18_0') + ' Mobile/22A3354 [FBAN/FBIOS;FBAV/480.0.0.0;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.0;FBLC/pt_BR]', null],
    ['Instagram por dentro', IOS('18_0') + ' Mobile/15E148 Instagram 350.0.0.0 (iPhone15,2; iOS 18_0; pt_BR; pt; scale=3.00; 1179x2556)', null],
    ['Snapchat por dentro', IOS('18_0') + ' Mobile/15E148 Snapchat/13.0.0.0 (like Safari/8619.1.26.30.5, panda)', null],
  ]) {
    const outro = await conviteNoIOS(se, ua);
    const r = await medirConviteIOS(outro.page, 'pt');
    if (vale) {
      checa(!r.ausente && r.chave === vale, `convite · ${nome} (R14-7-A2): o 1º passo não é o do menu do navegador`,
        JSON.stringify({ ausente: r.ausente, chave: r.chave }));
    } else {
      checa(r.ausente, `convite · ${nome} (R14-7-A2): o convite apareceu onde não há "Adicionar à Tela de Início"`);
    }
    await outro.ctx.close();
  }
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
  // O erro chega por window.onerror, NÃO por pageerror — o app o intercepta e
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
  const pedidosDeTile = new Map();
  await ctx.route('**/*-tiles/**', (r) => {
    const u = r.request().url();
    pedidosDeTile.set(u, (pedidosDeTile.get(u) || 0) + 1);
    return r.fulfill({ status });
  });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 80)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  // Uma fixture em que o mapa é o PRIMEIRO slide — sem foto, ou com mudança de
  // posição. A primeira versão pegava "a primeira com mapa", que tinha foto e
  // nenhuma mudança espacial: ali o mapa é o ÚLTIMO slide e nasce escondido,
  // então o teste contava zero marcador e acusava o app de perder a evidência.
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
  // O mapa AMPLIADO com os tiles caindo, arrastado devagar (um quadro por
  // passo): o tile que falhou não pode ser pedido de novo a cada quadro — era
  // 432 pedidos num arraste de 40 px, o mesmo tile até 30× (auditoria de
  // 2026-09-26). E a <img> quebrada sai do DOM.
  await page.click('#cardStack .place-card:not(.card-fundo) .card-map');
  await page.waitForTimeout(600);
  // Conta por URL o que o ARRASTE pediu de novo (o mini-mapa do card e o
  // ampliado pedem o mesmo tile uma vez cada, e isso é legítimo).
  const antesDoArraste = new Map(pedidosDeTile);
  checa(antesDoArraste.size >= 4, `${rot}: PRÉ-CONDIÇÃO — a medida não viu os pedidos de tile do ampliado (${antesDoArraste.size})`);
  await page.mouse.move(200, 450); await page.mouse.down();
  await page.mouse.move(240, 450, { steps: 30 }); await page.mouse.up();
  await page.waitForTimeout(500);
  let deNovo = 0, pior = 0;
  for (const [u, n] of antesDoArraste) { const d = pedidosDeTile.get(u) - n; deNovo += d; pior = Math.max(pior, d); }
  checa(deNovo === 0, `${rot}: o arraste de 40 px pediu de novo ${deNovo}× tiles que já tinham falhado (o mesmo até ${pior}×)`);
  checa(await page.evaluate(() => document.querySelectorAll('#mapaLbTiles img').length) === 0,
    `${rot}: <img> quebrada ficou no DOM do mapa ampliado`);
  await page.evaluate(() => MapaLightbox.close());
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
  //
  // E, entre esses, um em que o ENQUADRAMENTO não coincide com o PEDIDO — ou
  // seja com entrada ou posição proposta puxando a caixa. Sem isso o guard do
  // viewpoint não distingue as duas regras possíveis e passa verde com o
  // defeito de volta (gotcha #52: a fixture decide o que o teste consegue ver).
  const podeAbrirMapa = (f) => f.mapa && f.mapa.centro
    && (!(f.imageUrls || []).length
        || (f.changes || []).some((c) => c.field === 'geometry' || c.field === 'entryExitPoints'));
  const distingue = (f) => (f.mapa.entradas || []).length > 0 || !!f.mapa.proposto;
  const alvo = FIXTURES_PAISES.find((f) => podeAbrirMapa(f) && distingue(f))
            || FIXTURES_PAISES.find(podeAbrirMapa);
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

  // ── Street View: o SLOT DE AÇÃO deste lightbox ──────────────────────────
  //
  // O check de 44px acima varre só `button`, e este é um `<a>` — então ele
  // precisa da própria medida. E o que decide se o botão serve não é existir:
  // é receber o dedo (gotcha #26) e não cobrir o que já estava lá.
  const sv = await page.evaluate(() => {
    const a = document.getElementById('mapaLbStreetView');
    if (!a) return { falta: true };
    const r = a.getBoundingClientRect();
    // Redondo: os CANTOS da caixa ficam fora do círculo por geometria, então
    // a amostra é a cruz, não a grade 3x3.
    const perdidos = [[0.5, 0.5], [0.08, 0.5], [0.92, 0.5], [0.5, 0.08], [0.5, 0.92]]
      .filter(([fx, fy]) => {
        const t = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
        return !t || !(a === t || a.contains(t));
      }).length;
    // E o inverso: quantos pontos dos vizinhos ELE rouba.
    const rouba = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return 0;
      const b = e.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) return 0;
      let n = 0;
      for (let i = 0; i <= 10; i++) for (let j = 0; j <= 2; j++) {
        const t = document.elementFromPoint(b.left + b.width * (i / 10), b.top + b.height * (j / 2));
        if (t && t.closest('#mapaLbStreetView')) n++;
      }
      return n;
    };
    return {
      falta: false, w: Math.round(r.width), h: Math.round(r.height), perdidos,
      escondido: a.classList.contains('hidden'),
      href: a.getAttribute('href'), tag: a.tagName,
      alvo: a.getAttribute('target'), rel: a.getAttribute('rel'),
      rotulo: a.getAttribute('aria-label'),
      roubados: rouba('#mapaLbLegenda') + rouba('#mapaLbEscala')
              + rouba('#mapaLbClose') + rouba('#mapaLbCentrar') + rouba('#mapaLbMais'),
      centro: MapaLightbox.centro.slice(),
      local: AppState.currentPlace.mapa.centro.slice(),
    };
  });
  checa(!sv.falta, 'Street View: o botão não existe no lightbox do mapa');
  checa(!sv.escondido, 'Street View: nasceu escondido com coordenada válida');
  checa(sv.w >= 44 && sv.h >= 44, `Street View: alvo de ${sv.w}x${sv.h}, régua é 44px`);
  checa(sv.perdidos === 0, `Street View: ${sv.perdidos} pontos da cruz não recebem o dedo`);
  checa(sv.roubados === 0, `Street View: cobre ${sv.roubados} pontos de escala/legenda/✕/zoom`);
  checa(sv.alvo === '_blank' && /noopener/.test(sv.rel || '') && /noreferrer/.test(sv.rel || ''),
    'Street View: link externo sem target/rel seguro', `${sv.alvo} · ${sv.rel}`);
  checa(!!sv.rotulo && !/card\.map/.test(sv.rotulo),
    'Street View: aria-label ausente ou com a chave crua na tela', sv.rotulo);
  // A ORDEM das coordenadas: o viewpoint tem que sair lat,lon — e lido ao
  // contrário dá lugar plausível e errado, sem sintoma nenhum na tela.
  const vpDe = (h) => { try { return new URL(h).searchParams.get('viewpoint'); } catch { return null; } };
  // CONTROLE antes do guard: se neste cenário o enquadramento COINCIDIR com o
  // pedido, o guard abaixo não distingue as duas regras e passaria verde com o
  // defeito de volta (gotcha #28). Exigir a divergência é o que o torna teste.
  checa(sv.centro[0] !== sv.local[0] || sv.centro[1] !== sv.local[1],
    'Street View: fixture não distingue enquadramento de pedido — o guard abaixo vira decoração');
  // Com o mapa parado o viewpoint é o PEDIDO. O `centro` é a média dos
  // marcadores e em 31% da fila real (12 países) não é o local — medido: a
  // câmera do Google cai a 79 m de mediana pelo enquadramento contra 30 m pelo
  // pedido, com o pior caso indo de 10.885 m para 393 m.
  checa(vpDe(sv.href) === `${sv.local[0]},${sv.local[1]}`,
    'Street View: viewpoint não é o ponto do pedido em [lat, lon]', `${vpDe(sv.href)} vs ${sv.local}`);

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

  // Amarrar o href a um dos quatro caminhos deixaria os outros com o link
  // velho, e o panorama abriria no lugar anterior — sem erro na tela.
  const svArr = await page.evaluate(() => document.getElementById('mapaLbStreetView').getAttribute('href'));
  checa(vpDe(svArr) && vpDe(svArr) !== vpDe(sv.href),
    'Street View: arrastar não mexeu no link — ele ficou no ponto anterior');

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
  const svVolta = await page.evaluate(() => document.getElementById('mapaLbStreetView').getAttribute('href'));
  checa(vpDe(svVolta) === `${sv.local[0]},${sv.local[1]}`,
    'Street View: recentrar não devolveu o link ao ponto do pedido', `${vpDe(svVolta)} vs ${sv.local}`);

  // As QUATRO setas andam (L13, auditoria de 2026-09-26): o ↓ fechava o mapa,
  // copiado da foto, e pelo teclado não se chegava ao sul do pedido. O ↑ é o
  // CONTROLE de que a medida de "andou" enxerga.
  const lat0 = await page.evaluate(() => MapaLightbox.centro[0]);
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(150);
  const latN = await page.evaluate(() => MapaLightbox.centro[0]);
  checa(latN > lat0, 'mapa ampliado: CONTROLE — o ↑ não andou pro norte (a medida estaria cega)');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150);
  const s1 = await page.evaluate(() => ({ aberto: MapaLightbox.isOpen(), lat: MapaLightbox.centro[0] }));
  checa(s1.aberto && s1.lat < latN, 'mapa ampliado: o ↓ não andou pro sul (fechou o mapa ou não saiu do lugar)', JSON.stringify(s1));
  // Volta ao pedido (e reabre, se o ↓ fechou: o resto do bloco mede o mapa aberto).
  await page.evaluate(() => { if (MapaLightbox.isOpen()) MapaLightbox.recentrar(); });
  if (!s1.aberto) { await page.click('.card-map'); await page.waitForTimeout(400); }
  await page.waitForTimeout(300);

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

// ── Mapa ampliado no TOQUE: o Street View ABRE e o duplo toque APROXIMA ────
//
// Nos DOIS motores, com toque de verdade (`page.touchscreen`). O bloco de cima
// mede o Street View pelo `href` e pelo hit-test, e o duplo toque pelo mouse —
// e os dois passavam no WebKit com o recurso morto no iPhone: o `pointerdown`
// do mapa chamava `preventDefault()`, e no WebKit isso mata o `click` do toque.
// MEDIDO: o Street View não abria (0 de 2) e o duplo toque não aproximava
// (17 → 17); no Chromium, os dois funcionavam (auditoria de 2026-09-29, L20).
// CONTROLES: o ↗ do card (outro link externo) abre com o MESMO toque — prova
// de que a medida enxerga a aba —, e um toque SÓ não aproxima.
{
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block',
    hasTouch: true, isMobile: true });
  await ctx.route('**/*-tiles/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_CINZA }));
  // A aba que o toque abre não sai pra rede: o que se mede é ela NASCER.
  await ctx.route(/^https:\/\/www\.google\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>sv</title>' }));
  await ctx.route(/^https:\/\/www\.waze\.com\/editor/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>wme</title>' }));
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 80)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  const alvo = FIXTURES_PAISES.find((f) => f.mapa && f.mapa.centro && !(f.imageUrls || []).length);
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
  // O centro de um elemento, e QUEM recebe o dedo ali (gotcha #26).
  const centro = (sel) => page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const q = document.elementFromPoint(x, y);
    return { x, y, recebe: !!(q && (q === e || e.contains(q))) };
  }, sel);
  // Toca e espera a ABA que nasce do toque (ou nada, em 3 s).
  const tocarEAbrir = async (sel) => {
    const c = await centro(sel);
    if (!c || !c.recebe) return { semAlvo: true };
    const aba = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null);
    await page.touchscreen.tap(c.x, c.y);
    const p = await aba;
    if (!p) return { abriu: false };
    await p.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
    const url = p.url();
    await p.close().catch(() => {});
    return { abriu: true, url };
  };
  const rot = `mapa ampliado no toque (${MOTOR})`;
  // CONTROLE do instrumento: o ↗ do card abre a aba com o mesmo toque.
  const ctrl = await tocarEAbrir('.place-card:not(.card-fundo) .card-wme-link');
  checa(!ctrl.semAlvo, `${rot}: CONTROLE — o ↗ do card não está sob o dedo (a medida da aba não teria com o que comparar)`);
  checa(ctrl.abriu && /^https:\/\/www\.waze\.com\/editor/.test(ctrl.url || ''),
    `${rot}: CONTROLE — o toque no ↗ do card não abriu a aba (a medida estaria cega)`, JSON.stringify(ctrl));
  // Abre o mapa ampliado pelo toque no mapa do card.
  const cm = await centro('.place-card:not(.card-fundo) .card-map');
  if (cm) await page.touchscreen.tap(cm.x, cm.y);
  await page.waitForTimeout(600);
  checa(await page.evaluate(() => MapaLightbox.isOpen()), `${rot}: o toque no mapa do card não abriu o mapa ampliado`);
  // Um ponto do MAPA mesmo — não um controle —, perto do meio.
  const ponto = await page.evaluate(() => {
    const lb = document.getElementById('mapaLightbox').getBoundingClientRect();
    const x = lb.left + lb.width / 2, y = lb.top + lb.height * 0.45;
    const q = document.elementFromPoint(x, y);
    return { x, y, doMapa: !!(q && q.closest('#mapaLightbox') && !q.closest('button, a')) };
  });
  checa(ponto.doMapa, `${rot}: PRÉ-CONDIÇÃO — o ponto do toque não é do mapa (é um controle, ou está fora da camada)`);
  // CONTROLE: um toque SÓ não aproxima.
  const z0 = await page.evaluate(() => MapaLightbox.z);
  await page.touchscreen.tap(ponto.x, ponto.y);
  await page.waitForTimeout(450);                   // passa da janela do duplo toque (300 ms)
  const z1 = await page.evaluate(() => MapaLightbox.z);
  checa(z1 === z0, `${rot}: CONTROLE — um toque SÓ mudou o zoom (${z0} → ${z1}): a medida do duplo toque estaria mentindo`);
  // O duplo toque aproxima UM nível (no Chromium o `click` também chega, e
  // não pode aproximar dobrado).
  await page.touchscreen.tap(ponto.x, ponto.y);
  await page.waitForTimeout(90);
  await page.touchscreen.tap(ponto.x + 2, ponto.y + 1);
  await page.waitForTimeout(400);
  const z2 = await page.evaluate(() => MapaLightbox.z);
  checa(z2 === z1 + 1, `${rot}: o duplo toque no mapa foi de ${z1} pra ${z2} — tem que aproximar UM nível (no iPhone não aproximava)`);
  // O Street View ABRE a aba (no iPhone, 0 de 2).
  const sv = await tocarEAbrir('#mapaLbStreetView');
  checa(!sv.semAlvo, `${rot}: o Street View não está sob o dedo`);
  checa(sv.abriu && /^https:\/\/www\.google\.com\/maps\//.test(sv.url || ''),
    `${rot}: o toque no Street View não abriu a aba do panorama`, JSON.stringify(sv));
  checa(await page.evaluate(() => MapaLightbox.isOpen()), `${rot}: o toque no Street View fechou o mapa ampliado`);
  checa(erros.length === 0, `${rot}: erro de JS`, erros[0]);
  await ctx.close();
}

// ── A ESCALA mede o que diz (auditoria de 2026-09-26) ─────────────────────
//
// A barra de escala do card e a do ampliado diziam o DOBRO da distância: a
// conta usava o tile de 256 px e a projeção usa o de 512. E o traço (a borda
// de baixo) cobria também os 16 px de padding, que o `width` calculado não
// contava. O teste de unidade ancorava o valor errado, então só a TELA diz a
// verdade: a distância entre os dois marcadores de um pedido de MOVIMENTO,
// lida pela barra DESENHADA (o `getBoundingClientRect` do traço, não o
// `style.width` que o código pediu — gotcha #58), tem que dar o que o core
// mediu. Sabotado: com a conta de 256 px dá 2,0×; com o `content-box`, 0,8×.
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  await ctx.route('**/*-tiles/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_CINZA }));
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 80)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  // O pedido de movimento MAIS LONGO das fixtures: com poucos pixels entre os
  // marcadores o arredondamento vira ruído (pré-condição conferida abaixo).
  const alvo = FIXTURES_PAISES.filter((f) => f.mapa && f.mapa.proposto && f.mapa.movidoM > 1)
    .sort((a, b) => b.mapa.movidoM - a.mapa.movidoM)[0];
  checa(!!alvo, 'escala: nenhuma fixture de movimento — o bloco não mede nada');
  if (alvo) {
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
    await assentar(page);
    // Lê a distância PELA BARRA: pixels entre os centros dos dois marcadores ×
    // (metros do rótulo ÷ largura desenhada do traço).
    const lerPelaEscala = (sel) => page.evaluate(({ marcas, escala }) => {
      const centro = (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
      const a = document.querySelector(marcas + ' .mapa-marca.mapa-atual');
      const b = document.querySelector(marcas + ' .mapa-marca.mapa-proposto');
      const esc = document.querySelector(escala);
      if (!a || !b || !esc) return { falta: true };
      const [ax, ay] = centro(a), [bx, by] = centro(b);
      const txt = esc.textContent.trim();
      const n = parseFloat(txt.replace(/\./g, '').replace(',', '.'));
      const metros = /km/.test(txt) ? n * 1000 : n;
      const traco = esc.getBoundingClientRect().width;
      return { px: Math.hypot(bx - ax, by - ay), metros, traco, txt };
    }, sel);
    const conferir = (m, onde) => {
      if (m.falta) { checa(false, `escala ${onde}: faltou marcador ou barra — nada a medir`); return; }
      // PRÉ-CONDIÇÃO: marcadores perto demais fazem o erro de 1 px virar 10%.
      checa(m.px >= 20, `escala ${onde}: marcadores a ${m.px.toFixed(0)}px — perto demais pra medir`);
      checa(Number.isFinite(m.metros) && m.metros > 0 && m.traco > 0,
        `escala ${onde}: rótulo "${m.txt}" ou traço de ${m.traco}px ilegível — a medida está cega`);
      const lido = m.px * m.metros / m.traco;
      const razao = lido / alvo.mapa.movidoM;
      checa(Math.abs(razao - 1) <= 0.05,
        `escala ${onde}: lendo pela barra o movimento dá ${lido.toFixed(1)} m e o core mediu ${alvo.mapa.movidoM.toFixed(1)} m (${razao.toFixed(2)}×)`,
        `"${m.txt}" = ${m.traco.toFixed(1)}px · marcadores a ${m.px.toFixed(1)}px`);
    };
    conferir(await lerPelaEscala({ marcas: '#cardStack .place-card:not(.card-fundo) .card-map-marks',
      escala: '#cardStack .place-card:not(.card-fundo) .card-map-scale' }), 'do card');
    await page.click('#cardStack .place-card:not(.card-fundo) .card-map');
    await page.waitForTimeout(500);
    conferir(await lerPelaEscala({ marcas: '#mapaLbMarks', escala: '#mapaLbEscala' }), 'do mapa ampliado');
    // Nos zooms mais abertos o texto cabe no traço: a lista antiga parava em
    // 50 km e, do z6 pra baixo, o "50 km" ficava num traço de 22–38 px.
    for (const z of [8, 6, 5, 4]) {
      const e = await page.evaluate((zz) => {
        MapaLightbox.z = zz; MapaLightbox.desenhar();
        const el = document.getElementById('mapaLbEscala');
        const rg = document.createRange(); rg.selectNodeContents(el);
        return { traco: el.getBoundingClientRect().width, tinta: rg.getBoundingClientRect().width, txt: el.textContent };
      }, z);
      checa(e.tinta > 0 && e.tinta <= e.traco,
        `escala do mapa ampliado no z${z}: o rótulo "${e.txt}" (${e.tinta.toFixed(0)}px) não cabe no traço de ${e.traco.toFixed(0)}px`);
    }
    await page.evaluate(() => MapaLightbox.close());
  }
  checa(erros.length === 0, 'escala: erro de JS', erros[0]);
  await ctx.close();
}

// ── Lixeira do lightbox: portão, alvo e a camada da confirmação ──────────
//
// É o único caminho do app que ESCREVE no mapa em si, então a rede fica aqui e
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

// ── Aprovar foto nova: o único "aprovar" que o app tem ───────────────────
//
// A regra de ouro de produto é que o app não aprova, e a foto é a exceção
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
    await new Promise((k) => setTimeout(k, 350));
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

  // A pílula do nome, medida pelo ATRIBUTO e pelo PIXEL como os outros botões
  // (L9, auditoria de 2026-09-26): na janela ela parecia viva e o toque não
  // fazia nada. CONTROLE antes da janela: viva e acesa.
  const pilula = () => page.evaluate(() => {
    const b = document.getElementById('lightboxNomeBtn');
    const cs = getComputedStyle(b);
    return { visivel: !document.getElementById('lightboxNome').classList.contains('hidden'),
      disabled: b.disabled, opacity: parseFloat(cs.opacity), filtro: cs.filter };
  });
  const pil0 = await pilula();
  checa(pil0.visivel && !pil0.disabled && pil0.opacity === 1,
    'pílula do nome: CONTROLE — fora da janela ela não está viva e acesa (a medida estaria cega)', JSON.stringify(pil0));

  // A resposta visual é imediata; o ENVIO espera a janela fechar sozinha.
  enviados.length = 0;
  await page.click('#lightboxApprove'); await page.waitForTimeout(400);
  const pil1 = await pilula();
  checa(pil1.disabled, 'pílula do nome: continuou clicável durante o Desfazer — o toque nela não faz nada');
  checa(pil1.opacity < 1 && /grayscale/.test(pil1.filtro),
    `pílula do nome: está disabled mas PARECE viva na janela (opacity ${pil1.opacity}, filter ${pil1.filtro})`);
  checa(await page.evaluate(() => document.querySelectorAll('#undoContainer .undo-banner').length === 1),
    'aprovar: o banner de Desfazer não apareceu');
  checa(await escondido('lightboxApprove') && !(await escondido('lightboxDelete')),
    'aprovar: o botão não virou lixeira — a foto passou a estar no mapa e o card tem que dizer isso');
  checa(enviados.length === 0, `aprovar: enviou DURANTE a janela de Desfazer (${enviados.length} chamada(s))`);
  // Botão travado precisa PARECER travado — a mesma regra dos ✕/↑/✓ do card.
  // O owner viu a divergência: "não estão sendo desativados que nem é feito nos
  // cards". Mede o ATRIBUTO e o PIXEL, porque `disabled` sem esmaecer continua
  // lendo como app quebrado (M3/HIG), e esmaecer sem `disabled` engana o Tab e
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
  //
  // A pílula (e o card) seguem travados enquanto a aprovação está NO AR, e é a
  // RESPOSTA que solta (A1: o ✕ do card mandava uma segunda decisão do pedido
  // que estava sendo aprovado). Espera o FIM — a aprovação respondida
  // (`placeResolvidoPorAprovacao`, com o lightbox aberto) —, nunca um prazo: os
  // 3,2 s fixos mediam a velocidade da máquina e reprovaram sob carga, com o
  // código certo. A marca existe também no app de antes, então o bloco mede os
  // dois lados.
  const respondida = await esperarNaPagina(page, () => placeResolvidoPorAprovacao !== null, 10000, 50);
  checa(respondida.ok, 'aprovar: a aprovação não foi enviada e respondida ao fim da janela (a espera estourou)');
  const pil2 = await pilula();
  checa(!pil2.disabled && pil2.opacity === 1, 'pílula do nome: não voltou a ser botão depois da janela', JSON.stringify(pil2));
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

// ── Foto que NÃO CARREGOU não se aprova nem se exclui (auditoria de 2026-09-26)
//
// A exceção que deixa o app aprovar FOTO existe porque a decisão está inteira
// na tela — e pra aprovar é preciso ter VISTO a foto. MEDIDO: pelo carrossel,
// a proposta com 404 abria no lightbox com o ícone de imagem quebrada, o ✨ e o
// "Aprovar" ativo, e aprovar mandava `approve: true` de uma foto que ninguém
// viu. O CONTROLE é a foto que carrega: nela a lixeira TEM que aparecer (sem
// ele, "escondido" passaria também com o portão fechado ou o lightbox vazio).
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  const enviados = [];
  await ctx.route('**/api/validar-place', async (r) => {
    enviados.push(JSON.parse(r.request().postData() || '{}'));
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await ctx.route('**/api/excluir-foto', async (r) => {
    const c = JSON.parse(r.request().postData() || '{}');
    if (c.action !== 'preparar') enviados.push(c);
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await ctx.route('https://venue-image.waze.com/**', (r) => r.fulfill({ status: 404, body: 'not found' }));
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 80)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  const PLACE = {
    venueID: 'v-quebrada', updateRequestID: 'pend-01', name: 'Foto que não veio',
    categories: ['PARK'], address: 'Rua X, 1', updateTypeKey: 'IMAGE', purType: 'NEW_PHOTO',
    createdBy: 'fulano', lat: -12.9, lon: -38.3, changes: [], mapa: null,
    // A proposta é a foto QUEBRADA; a aprovada, uma que carrega.
    imageUrls: ['https://venue-image.waze.com/thumbs/thumb700_pend-01.jpg', `${foto}#aprovada-02`],
    approvedImageIds: ['aprovada-02'],
  };
  await page.evaluate(async (pl) => {
    setLang('pt'); applyI18n();
    AppState.authenticated = true;
    API.setSession('token-smoke');
    AppState.profile = { userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
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
  }, PLACE);
  const estado = () => page.evaluate(() => {
    const im = document.getElementById('lightboxImage');
    const vis = (id) => !document.getElementById(id).classList.contains('hidden');
    return { aberto: Lightbox.isOpen(), idx: Lightbox.idx, carregou: im.complete && im.naturalWidth > 0,
      aprovar: vis('lightboxApprove'), lixeira: vis('lightboxDelete') };
  });
  // Pelo carrossel do card até a foto que carrega, e dela pro lightbox — o
  // caminho do relato (a proposta quebrada nem abre pelo card).
  await page.click('#cardStack .place-card:not(.card-fundo) .card-image-next');
  await page.waitForTimeout(250);
  await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
  await page.waitForTimeout(400);
  const naBoa = await estado();
  checa(naBoa.aberto && naBoa.idx === 1 && naBoa.carregou,
    'foto quebrada: PRÉ-CONDIÇÃO — o lightbox não abriu na foto que carrega', JSON.stringify(naBoa));
  checa(naBoa.lixeira, 'foto quebrada: CONTROLE — a lixeira não apareceu na foto que CARREGOU (a medida estaria cega)');
  await page.click('#lightboxPrev');
  await page.waitForTimeout(600);
  const naQuebrada = await estado();
  checa(naQuebrada.idx === 0 && !naQuebrada.carregou,
    'foto quebrada: PRÉ-CONDIÇÃO — a proposta devia estar na tela SEM carregar', JSON.stringify(naQuebrada));
  checa(!naQuebrada.aprovar, 'foto quebrada: o "Aprovar" apareceu numa foto que não carregou');
  checa(!naQuebrada.lixeira, 'foto quebrada: a lixeira apareceu numa foto que não carregou');
  // E por dentro: o clique no botão escondido (teclado, script) não aprova.
  await page.evaluate(() => { document.getElementById('lightboxApprove').click(); });
  await page.waitForTimeout(3600);
  checa(enviados.length === 0, `foto quebrada: ${enviados.length} escrita(s) saíram de uma foto que ninguém viu`,
    JSON.stringify(enviados));
  // Voltando pra foto que carrega, a lixeira volta (a regra é reavaliada).
  await page.click('#lightboxNext');
  await page.waitForTimeout(400);
  checa((await estado()).lixeira, 'foto quebrada: a lixeira não voltou na foto que carrega');
  checa(erros.length === 0, 'foto quebrada: erro de JS', erros[0]);
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

// ── Falha NUNCA pode virar "Tudo limpo!" ────────────────────────────────
//
// A tela que o owner mandou: "Tudo limpo!", 0 RESTAM, e o toast "Conexão
// instável — sua sessão continua válida" no rodapé. MEDIDO na produção no mesmo
// minuto: a fila dele tinha 217 pedidos. O app afirmou que o trabalho acabou.
//
// É o defeito mais caro do projeto pela régua dele mesmo — "parece que acabou o
// trabalho" ninguém reporta, porque a pessoa fecha o app satisfeita.
//
// Guard de texto não pega: `showNoPlaces` já lia `loadError` e o comentário dele
// já dizia a intenção. O que faltava era o ramo de 401 do `fetchNextPage`
// MARCAR a flag. Só reproduzindo a rede aparece.
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 80)));

  let buscas = 0;
  await ctx.route('**/api/buscar-places', (r) => {
    buscas++;
    r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({
      success: false, error: 'Sessão expirada ou inválida',
      errorKey: 'srv.err.sessionExpired', errorCategory: 'unauthorized' }) });
  });
  // O perfil RESPONDE — é o que faz o `handleUnauthorized` concluir alarme falso
  // e mostrar "conexão instável" em vez de derrubar. Exatamente o par da tela.
  await ctx.route('**/api/perfil', (r) => r.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify({ success: true,
      profile: { userName: 'antigerme', rank: 5, isAreaManager: true, isStaff: false, areas: [] } }) }));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);

  const r = await page.evaluate(async () => {
    setLang('pt'); applyI18n();
    window.__toasts = [];
    if (!window.__origToast) window.__origToast = window.showToast;
    window.showToast = (m, t, d) => { window.__toasts.push(String(m)); return window.__origToast(m, t, d); };
    API.setSession('token-de-teste');
    AppState.authenticated = true;
    AppState.preferences.comoFuncionaVisto = true;
    AppState.profile = { userName: 'antigerme', rank: 5, isAreaManager: true, isStaff: false, areas: [] };
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    verificandoSessao = false;
    AppState.queue = []; AppState.serverTotal = 0; AppState.loadError = false;
    await startFetching();
    // Espera a poeira baixar: o `handleUnauthorized` dorme antes de conferir, e
    // a rebusca do alarme falso vem depois dele. Esperar por TEMPO fixo mediria
    // o meio do caminho — espera até a tela parar de mudar.
    await new Promise((k) => {
      const limite = Date.now() + 8000;
      let anterior = '';
      const olha = () => {
        const agora = [document.getElementById('noMoreCards').classList.contains('hidden'),
                       document.getElementById('loadErrorState').classList.contains('hidden'),
                       AppState.fetching].join('|');
        if ((agora === anterior && !AppState.fetching) || Date.now() > limite) k();
        else { anterior = agora; setTimeout(olha, 250); }
      };
      setTimeout(olha, 1500);
    });
    const vis = (id) => { const e = document.getElementById(id);
      return !!e && !e.classList.contains('hidden') && !!e.offsetParent; };
    return { tudoLimpo: vis('noMoreCards'), falhaAoCarregar: vis('loadErrorState'),
             loadError: AppState.loadError, fila: AppState.queue.length,
             toasts: window.__toasts };
  });

  // A asserção que importa, e ela tem as DUAS metades: sem a segunda, um
  // "esconde tudo" passaria; sem a primeira, mostrar os dois passaria.
  checa(!r.tudoLimpo, 'falha virou "Tudo limpo!" — o app afirmou que o backlog zerou (é a tela do owner)');
  checa(r.falhaAoCarregar, 'falha não mostrou "Falha ao carregar" com o botão de tentar de novo');
  checa(r.fila === 0, 'controle: a fila tinha que estar vazia neste cenário', String(r.fila));
  // E o toast do alarme falso continua aparecendo: o conserto não pode
  // transformar oscilação em "sua sessão morreu" (gotcha #42).
  checa(r.toasts.some((m) => /instável/i.test(m)),
    'o aviso de "conexão instável" sumiu — oscilação virou silêncio', r.toasts.join(' | ').slice(0, 70));
  checa(buscas >= 1, 'controle: nenhuma busca saiu — o cenário não exercitou nada');
  checa(erros.length === 0, 'tudo-limpo: erro de JS', erros[0]);
  await ctx.close();
}

// ── A BUSCA atravessando a QUEDA da sessão (R14-1-01, R14-1-02) ─────────────
//
// R14-1-01 (auditoria da rodada 14, a mais grave dela; igual desde o #252):
// abrir o app com a sessão salva VENCIDA e a extensão logada no WME — o caminho
// mais comum da renovação. A busca da abertura leva o 401, a sessão cai e a
// extensão a renova em silêncio; a renovação chamava um `startFetching` cru, que
// apagava a falha da busca, e a recomposição (`rebuscarDepoisDeFalha`) já não
// via o que recompor: "Tudo limpo!", com a fila inteira pendente no Waze. Aqui a
// abertura de VERDADE, com a API de mentira (a sessão salva morta, a nova viva)
// e a extensão de mentira respondendo pela ponte (`precisa-de-sessao` →
// `aguarde` + `sessao`). O que se mede é o que a pessoa vê: a fila chega, e o
// "Tudo limpo!" não aparece em momento NENHUM (um observador conta cada vez que
// o painel aparece). CONTROLE: a mesma abertura na ordem do app de antes (o
// `startFetching` antes da recomposição, injetado na página) — o painel TEM de
// aparecer, senão o instrumento não enxerga o defeito.
//
// R14-1-02: a busca que estava no ar quando a sessão CAI responde depois, com a
// aba já na tela de entrada. Ela entrava na fila: o card montado atrás da tela de
// entrada e "Novo pedido: …" na região viva que o `showAuthScreen` acabou de
// limpar. CONTROLE: a mesma resposta ANTES da queda entra (é o desenho: a queda
// mantém a fila pra renovação), e o instrumento enxerga o card no DOM.
{
  const sessaoMorta = { success: false, error: 'Sessão expirada', errorKey: 'srv.err.sessionExpired', errorCategory: 'unauthorized' };
  const pedidoR = (n) => ({ venueID: 'vr' + n, updateRequestID: 'ur' + n, purType: 'NEW_PLACE', updateTypeKey: 'NEW_PLACE',
    name: `Local da renovação ${n}`, categories: ['PARK'], address: '', createdBy: 'wazer' + n, creatorId: 300 + n,
    imageUrls: [], mapa: null, lat: -12.9, lon: -38.3, dateAdded: Date.UTC(2026, 9, 7, 12, 0, 0) - n * 60000 });
  const CINCO = [1, 2, 3, 4, 5].map(pedidoR);
  // A API de mentira: as sessões vivas (`vivas`), e a busca segurada quando o
  // teste quer (`segurar.promessa`). A presença responde sempre (o assunto aqui é
  // a busca, e a sentinela do 401 da presença fica quieta).
  const montarApi = async (ctx, { vivas, segurar = {} }) => {
    const rede = [];
    await ctx.route('**/api/**', async (r) => {
      const nome = r.request().url().split('/api/')[1].split(/[?#]/)[0];
      let corpo = {};
      try { corpo = JSON.parse(r.request().postData() || '{}'); } catch { corpo = {}; }
      rede.push({ nome, token: corpo.sessionToken || null });
      // A resposta é decidida na CHEGADA, com a sessão de então: a busca segurada
      // passou pelo servidor antes de a sessão morrer, e volta BOA.
      let resp;
      if (nome === 'presenca-app') resp = { success: true, online: [], conversas: [] };
      else if (nome === 'sessao') resp = { success: true };
      else if (!vivas.has(corpo.sessionToken)) resp = sessaoMorta;
      else if (nome === 'perfil') {
        resp = { success: true, visivelNoWme: true, referencias: null, profile: { id: 111, userName: 'ed111', rank: 5,
          isAreaManager: true, isStaff: false, editableCountryIDs: [30], areas: [], managedAreas: [] } };
      } else if (nome === 'buscar-places') resp = { success: true, places: CINCO, hasMore: false, page: 1, total: 5, blocked: 0 };
      else if (nome === 'lista-paises') resp = { success: true, countries: [{ id: 30, name: 'Brazil' }] };
      else resp = { success: true };
      if (nome === 'buscar-places' && segurar.promessa) await segurar.promessa;
      await r.fulfill({ status: resp.errorCategory === 'unauthorized' ? 401 : 200, contentType: 'application/json',
        body: JSON.stringify(resp) }).catch(() => {});
    });
    return rede;
  };
  // A aba, com a sessão salva no aparelho. `extensao`: a ponte de mentira renova
  // com a sessão nova. `antigaOrdem`: o CONTROLE do R14-1-01. Conta cada vez que
  // o "Tudo limpo!" aparece e cada anúncio da região viva do card.
  const abrirAba = async ({ token, vivas, extensao = false, antigaOrdem = false, segurar = {} }) => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block', locale: 'pt-BR' });
    const rede = await montarApi(ctx, { vivas, segurar });
    await ctx.addInitScript(({ token, extensao, antigaOrdem }) => {
      try {
        if (!sessionStorage.getItem('__r14busca')) {
          sessionStorage.setItem('__r14busca', '1');
          localStorage.setItem('waze_session_token', token);
          localStorage.setItem('waze_places_lang', 'pt');
        }
      } catch (e) { /* armazenamento bloqueado: o teste segue */ }
      window.__perguntasDaExtensao = 0;
      if (extensao) {
        window.addEventListener('message', (ev) => {
          const d = ev.data;
          if (ev.source !== window || !d || d.source !== 'wazeplaces' || d.action !== 'precisa-de-sessao') return;
          window.__perguntasDaExtensao++;
          window.postMessage({ source: 'wazeplaces-ext', action: 'aguarde' }, location.origin);
          setTimeout(() => window.postMessage({ source: 'wazeplaces-ext', action: 'sessao', token: 'tok-r14-nova', conta: '111' },
            location.origin), 200);
        });
      }
      window.__tudoLimpoApareceu = 0;
      window.__anuncios = [];
      document.addEventListener('DOMContentLoaded', () => {
        const painel = document.getElementById('noMoreCards');
        let escondido = painel.classList.contains('hidden');
        new MutationObserver(() => {
          const agora = painel.classList.contains('hidden');
          if (escondido && !agora) window.__tudoLimpoApareceu++;
          escondido = agora;
        }).observe(painel, { attributes: true, attributeFilter: ['class'] });
        const regiao = document.getElementById('cardLiveRegion');
        new MutationObserver(() => { if (regiao.textContent) window.__anuncios.push(regiao.textContent); })
          .observe(regiao, { childList: true, characterData: true, subtree: true });
        // O CONTROLE: a ordem do app de antes — o `startFetching` cru da renovação
        // rodava ANTES da recomposição, e apagava a falha que ela lia.
        if (antigaOrdem) {
          const recompor = window.rebuscarDepoisDeFalha;
          window.rebuscarDepoisDeFalha = function () { startFetching(); return recompor.apply(this, arguments); };
        }
      });
    }, { token, extensao, antigaOrdem });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 120)));
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    return { ctx, page, rede, erros };
  };

  // ── R14-1-01: a abertura com a sessão salva morta, e a extensão que renova ──
  const renovar = async ({ antigaOrdem }) => {
    const a = await abrirAba({ token: 'tok-r14-velha', vivas: new Set(['tok-r14-nova']), extensao: true, antigaOrdem });
    // O FIM: a sessão nova na memória, nada no ar, e a tela decidida (o card ou o painel).
    const fim = await esperarNaPagina(a.page, () => typeof API !== 'undefined' && API.sessionToken === 'tok-r14-nova'
      && !extPerguntando && !AppState.fetching && AppState.inFlightActions === 0
      && (!!AppState.currentPlace || window.__tudoLimpoApareceu > 0), 15000);
    const r = await a.page.evaluate(() => ({ fila: AppState.queue.length, tudoLimpo: window.__tudoLimpoApareceu,
      perguntas: window.__perguntasDaExtensao, card: !!document.querySelector('#cardStack .place-card:not(.card-fundo)') }));
    const buscas = a.rede.filter((x) => x.nome === 'buscar-places').map((x) => x.token);
    const erros = a.erros.slice();
    await a.ctx.close();
    return { fim: fim.ok, ...r, buscas, erros };
  };
  const r1 = await renovar({ antigaOrdem: false });
  checa(r1.fim, 'renovação (R14-1-01): a abertura não chegou ao fim (a sessão nova, nada no ar)', JSON.stringify(r1));
  checa(r1.buscas[0] === 'tok-r14-velha' && r1.perguntas >= 1,
    'renovação (R14-1-01): PRÉ-CONDIÇÃO — a busca da abertura não saiu com a sessão salva morta, ou a extensão não foi perguntada',
    JSON.stringify(r1));
  checa(r1.buscas.includes('tok-r14-nova') && r1.fila === 5 && r1.card,
    'renovação (R14-1-01): a fila não foi buscada com a sessão nova — a pessoa fica sem os pedidos pendentes no Waze', JSON.stringify(r1));
  checa(r1.tudoLimpo === 0, 'renovação (R14-1-01): "Tudo limpo!" apareceu no meio da renovação, com a fila pendente no Waze',
    JSON.stringify(r1));
  checa(r1.erros.length === 0, 'renovação (R14-1-01): erro de JS', r1.erros[0]);
  const c1 = await renovar({ antigaOrdem: true });
  checa(c1.tudoLimpo > 0 && !c1.buscas.includes('tok-r14-nova'),
    'renovação (R14-1-01): CONTROLE — na ordem do app de antes, o "Tudo limpo!" tinha de aparecer sem a busca da sessão nova; a medida não enxerga o defeito',
    JSON.stringify(c1));

  // ── R14-1-02: a busca do ↻ responde DEPOIS da queda (sem extensão) ──
  const depoisDaQueda = async ({ soltarAntes }) => {
    const vivas = new Set(['tok-r14-a']);
    const segurar = {};
    const a = await abrirAba({ token: 'tok-r14-a', vivas, segurar });
    await esperarOuExplodir(a.page, () => AppState.authenticated && !!AppState.currentPlace && !AppState.fetching,
      'a abertura com a fila (R14-1-02)');
    segurar.promessa = new Promise((ok) => { segurar.soltar = ok; });
    await a.page.evaluate(() => document.getElementById('refreshBtn').click());
    await esperarOuExplodir(a.page, () => AppState.fetching === true, 'a busca do ↻ no ar (R14-1-02)');
    if (soltarAntes) {
      segurar.soltar();
      await esperarOuExplodir(a.page, () => !AppState.fetching && !!AppState.currentPlace, 'a busca do ↻ responder antes da queda');
    }
    // A sessão morre no servidor, e a conferência a derruba (sem extensão: a tela de entrada).
    vivas.delete('tok-r14-a');
    await a.page.evaluate(() => { handleUnauthorized(); });
    await esperarOuExplodir(a.page, () => !extPerguntando && !document.getElementById('authScreen').classList.contains('hidden'),
      'a aba cair na tela de entrada (R14-1-02)', 12000);
    const anunciosNaQueda = await a.page.evaluate(() => window.__anuncios.length);
    if (!soltarAntes) {
      segurar.soltar();
      await esperarNaPagina(a.page, () => !AppState.fetching, 5000);
    }
    await dormir(300);
    const r = await a.page.evaluate((n0) => ({ fila: AppState.queue.length,
      cardNoDom: !!document.querySelector('#cardStack .place-card:not(.card-fundo)'),
      regiaoViva: document.getElementById('cardLiveRegion').textContent,
      anunciosDepois: window.__anuncios.slice(n0), entrada: !document.getElementById('authScreen').classList.contains('hidden') }),
    anunciosNaQueda);
    const erros = a.erros.slice();
    await a.ctx.close();
    return { ...r, erros };
  };
  const r2 = await depoisDaQueda({ soltarAntes: false });
  checa(r2.entrada && r2.fila === 0 && !r2.cardNoDom,
    'busca depois da queda (R14-1-02): os pedidos da busca de antes da queda entraram na fila da aba deslogada (o card montado atrás da tela de entrada)',
    JSON.stringify(r2));
  checa(r2.anunciosDepois.length === 0 && r2.regiaoViva === '',
    'busca depois da queda (R14-1-02): a região viva anunciou um pedido na tela de entrada', JSON.stringify(r2));
  checa(r2.erros.length === 0, 'busca depois da queda (R14-1-02): erro de JS', r2.erros[0]);
  const c2 = await depoisDaQueda({ soltarAntes: true });
  checa(c2.fila === 5 && c2.cardNoDom && c2.anunciosDepois.length === 0 && c2.regiaoViva === '',
    'busca depois da queda (R14-1-02): CONTROLE — a resposta de ANTES da queda devia ficar na fila (o card no DOM), sem anúncio depois da queda; a medida não enxerga o card',
    JSON.stringify(c2));
}

// ── O local da divisa não entra duas vezes ────────────────────────────────
//
// MEDIDO na fila real do Brasil (2026-09-25): o Waze pagina por PEDIDO, mas cada
// página traz o LOCAL com todos os pedidos pendentes dele, e o local que fica na
// divisa vinha nas duas páginas — 5 pedidos repetidos em 697. O `fetchNextPage`
// de verdade roda duas vezes contra uma busca de duas páginas que repete os dois
// pedidos de um local. A segunda relê a página 1 (a busca sempre recomeça do
// topo — ver o bloco "A fila VIVA", logo abaixo), acha só o que já passou pela
// fila e anda até a 2; a fila tem que terminar sem repetido e o "Restam"
// contando cada pedido uma vez só.
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 80)));
  const pedido = (v, u, i) => ({ venueID: v, updateRequestID: u, purType: 'NEW_PLACE', updateTypeKey: 'NEW_PLACE',
    name: `Local ${v}`, categories: ['RESTAURANT'], address: '', createdBy: 'wazer', creatorId: 7,
    imageUrls: [], mapa: null, lat: -23.5, lon: -46.6, dateAdded: Date.UTC(2026, 8, 25, 12, 0, 0) - i * 60000 });
  const PAGINA = {
    1: [pedido('A', 'a1', 1), pedido('B', 'b1', 2), pedido('C', 'c1', 3), pedido('C', 'c2', 4), pedido('D', 'd1', 5)],
    2: [pedido('C', 'c1', 3), pedido('C', 'c2', 4), pedido('E', 'e1', 6), pedido('F', 'f1', 7)],
  };
  const paginasServidas = [];
  await ctx.route('**/api/buscar-places', (r) => {
    let n = 1;
    try { n = JSON.parse(r.request().postData() || '{}').page || 1; } catch { n = 1; }
    paginasServidas.push(n);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: true, places: PAGINA[n] || [], hasMore: n === 1, page: n, total: 0 }) });
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  const r = await page.evaluate(async () => {
    API.setSession('token-de-teste');
    AppState.authenticated = true;
    AppState.preferences.comoFuncionaVisto = true;
    AppState.profile = { userName: 'antigerme', rank: 5, isAreaManager: true, isStaff: false, areas: [] };
    resetQueue();
    await fetchNextPage();
    const depoisDa1 = AppState.queue.length;
    await fetchNextPage();
    const chaves = AppState.queue.map((p) => p.venueID + '|' + p.updateRequestID);
    return { depoisDa1, fila: chaves.length, distintos: new Set(chaves).size, restam: AppState.serverTotal,
             diario: dfatoAnel.filter((e) => e && e.k === 'busca.reposicao')
               .map((e) => ({ paginas: e.paginas, novos: e.novos, jaVistos: e.jaVistos })) };
  });
  checa(JSON.stringify(paginasServidas) === '[1,1,2]',
    'a segunda busca tinha que reler a página 1 e andar até a 2', JSON.stringify(paginasServidas));
  checa(r.depoisDa1 === 5, 'controle: a página 1 entra inteira', String(r.depoisDa1));
  checa(r.fila === 7 && r.distintos === 7, 'o local da divisa entrou duas vezes na fila',
    `${r.fila} cards, ${r.distintos} distintos`);
  checa(r.restam === 7, 'o "Restam" contou o repetido duas vezes', String(r.restam));
  checa(JSON.stringify(r.diario) === '[{"paginas":2,"novos":2,"jaVistos":7}]',
    'o diário não registrou a busca que releu as duas páginas', JSON.stringify(r.diario));
  checa(erros.length === 0, 'local da divisa: erro de JS', erros[0]);
  await ctx.close();
}

// ── A fila VIVA: a busca relê do topo, e sem rede ela espera ──────────────
//
// MEDIDO na fila real do Brasil (2026-09-25): o Waze conta a página sobre a
// lista do MOMENTO do pedido. O app pedia a "próxima página" quando sobravam 3
// cards, ou seja depois de a pessoa tratar a página 1 — e a essa altura os
// pedidos da página 2 já tinham subido pra página 1: a "página 2" vinha curta
// ou vazia, e o "Tudo limpo!" aparecia com pedidos pendentes. O "Waze" daqui
// faz o mesmo: 12 pedidos, páginas de 5, e cada ✕ tira o pedido da lista. A
// pessoa trata a fila inteira pelo BOTÃO, com o Desfazer desligado (modo dev),
// e cada card tem que aparecer uma vez só, com o "Tudo limpo!" chegando só
// quando o Waze não tem mais nada. A mesma regra de Waze, com a lógica antiga,
// perde 2 pedidos — o controle disso está no `test/busca-viva.test.mjs`.
//
// E a segunda metade é a de quem perde o SINAL no meio da triagem: com card na
// fila a busca espera calada (nenhum pedido ao servidor, nenhum toast), com a
// fila vazia a tela é a de "sem conexão" e nunca o "Tudo limpo!", e a rede de
// volta manda o que foi decidido sem sinal e traz o que ainda faltava.
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  // A rede voltando faz a presença pedir a lista de novo, e a sessão daqui é falsa.
  await presencaViva(ctx);
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 80)));
  const POR_PAGINA = 5;
  const pendentes = [];
  const chegar = (de, ate) => { for (let i = de; i <= ate; i++) pendentes.push({ venueID: 'V' + i, updateRequestID: 'R' + i, i }); };
  chegar(1, 12);
  const pedido = (p) => ({ venueID: p.venueID, updateRequestID: p.updateRequestID, purType: 'NEW_PLACE',
    updateTypeKey: 'NEW_PLACE', name: `Local ${p.venueID}`, categories: ['RESTAURANT'], address: '',
    createdBy: 'wazer' + p.i, creatorId: 100 + p.i, imageUrls: [], mapa: null, lat: -23.5, lon: -46.6,
    dateAdded: Date.UTC(2026, 8, 25, 12, 0, 0) - p.i * 60000 });
  const buscas = [];
  await ctx.route('**/api/buscar-places', (r) => {
    let n = 1;
    try { n = JSON.parse(r.request().postData() || '{}').page || 1; } catch { n = 1; }
    const fatia = pendentes.slice((n - 1) * POR_PAGINA, n * POR_PAGINA);
    buscas.push({ page: n, chaves: fatia.map((p) => p.updateRequestID) });
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: true, places: fatia.map(pedido), hasMore: n * POR_PAGINA < pendentes.length, page: n, total: fatia.length }) });
  });
  const decididos = [];
  await ctx.route('**/api/validar-place', (r) => {
    let d = {};
    try { d = JSON.parse(r.request().postData() || '{}'); } catch { d = {}; }
    const i = pendentes.findIndex((p) => p.venueID === d.venueID && p.updateRequestID === d.updateRequestID);
    if (i >= 0) pendentes.splice(i, 1);
    decididos.push(`${d.venueID}|${d.updateRequestID}`);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await esperarOuExplodir(page, () => typeof AppState !== 'undefined' && typeof startFetching === 'function', 'o app');
  await page.evaluate(async () => {
    API.setSession('token-de-teste');
    AppState.authenticated = true;
    AppState.devMode = { unlocked: true, active: true };
    AppState.preferences.undoEnabled = false;
    AppState.preferences.comoFuncionaVisto = true;
    AppState.profile = { id: 1, userName: 'antigerme', rank: 5, isAreaManager: true, isStaff: false, areas: [] };
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    resetQueue();
    await startFetching();
  });
  // A tela, lida como a pessoa a vê: o card da FRENTE, e qual painel está aberto.
  const tela = () => page.evaluate(() => {
    const f = document.querySelector('#cardStack .place-card:not(.card-fundo)');
    const aberto = (id) => !document.getElementById(id).classList.contains('hidden');
    return { card: f ? (f.querySelector('.card-name') || {}).textContent : null,
             limpo: aberto('noMoreCards'), falha: aberto('loadErrorState'),
             titulo: (document.querySelector('#loadErrorState h3') || {}).textContent || '',
             // A VARIANTE do painel é a chave que o `showNoPlaces` pôs no título,
             // não as palavras (que já trocaram: "sem conexão" virou "sem sinal").
             variante: (document.querySelector('#loadErrorState h3') || { getAttribute: () => '' }).getAttribute('data-i18n') || '',
             fila: AppState.queue.length, hasMore: AppState.hasMore, emVoo: AppState.inFlightActions };
  });
  // Trata o card da frente pelo ✕ e espera a tela mudar (outro card, ou um
  // painel). O nome do card de antes fica NA PÁGINA: a espera não repassa
  // argumento, e sem ele toda espera voltaria na hora, com o mesmo card na tela.
  const rejeitarDaFrente = async () => {
    await page.evaluate(() => {
      const f = document.querySelector('#cardStack .place-card:not(.card-fundo)');
      window.__cardAntes = (f.querySelector('.card-name') || {}).textContent;
      f.querySelector('.card-btn-reject').click();
    });
    const mudou = await esperarNaPagina(page, () => {
      const f = document.querySelector('#cardStack .place-card:not(.card-fundo)');
      const aberto = (id) => !document.getElementById(id).classList.contains('hidden');
      const agora = f ? (f.querySelector('.card-name') || {}).textContent : null;
      return (agora && agora !== window.__cardAntes) || aberto('noMoreCards') || aberto('loadErrorState');
    }, 15000, 100);
    return { mudou: mudou.ok };
  };

  const vistos = [];
  let aTelaParou = null;
  for (let passo = 0; passo < 30; passo++) {
    const t = await tela();
    if (!t.card) break;
    vistos.push(t.card);
    const { mudou } = await rejeitarDaFrente();
    if (!mudou) { aTelaParou = await tela(); break; }
  }
  await esperarNaPagina(page, () => AppState.inFlightActions === 0 && !AppState.fetching, 10000, 100);
  const fim = await tela();
  checa(aTelaParou === null, 'fila viva: a tela parou depois de um ✕', JSON.stringify(aTelaParou));
  checa(buscas.some((b) => b.page === 1 && b.chaves.includes('R6')),
    'PRÉ-CONDIÇÃO: o pedido R6, da página 2, tinha que ter SUBIDO pra página 1 numa releitura — sem isso o "Waze" daqui não é vivo',
    JSON.stringify(buscas.map((b) => b.page + ':' + b.chaves.join(','))));
  checa(new Set(vistos).size === vistos.length, 'fila viva: um card apareceu duas vezes', vistos.join(' '));
  checa(vistos.length === 12 && decididos.length === 12,
    `fila viva: a pessoa viu ${vistos.length} de 12 cards (${decididos.length} decididos)`, vistos.join(' '));
  checa(pendentes.length === 0 && fim.limpo && !fim.falha,
    'fila viva: o "Tudo limpo!" tinha que chegar, e só com o Waze vazio',
    JSON.stringify({ pendentes: pendentes.map((p) => p.updateRequestID), fim }));

  // ── sem sinal no meio da triagem ──
  chegar(20, 25);                                    // seis pedidos novos no Waze
  await page.evaluate(async () => { resetQueue(); await startFetching(); });
  const comRede = await tela();
  const buscasAntes = buscas.length;
  // O toast some em 4 s: conta os de ERRO que NASCEM daqui pra frente.
  await page.evaluate(() => {
    window.__toastsDeErro = 0;
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && String(n.className).includes('bg-rose-600')) window.__toastsDeErro++;
      }
    }).observe(document.getElementById('toastContainer'), { childList: true, subtree: true });
  });
  await ctx.setOffline(true);
  const semRede = [];
  for (let passo = 0; passo < 10; passo++) {
    const t = await tela();
    if (!t.card) break;
    semRede.push(t.card);
    const { mudou } = await rejeitarDaFrente();
    if (!mudou) break;
  }
  await page.waitForTimeout(300);
  const vazioSemRede = await tela();
  const toastsVermelhos = await page.evaluate(() => window.__toastsDeErro);
  checa(comRede.card && comRede.fila === 5 && comRede.hasMore,
    'sem sinal: PRÉ-CONDIÇÃO — a página 1 dos seis novos tinha que entrar com mais por vir', JSON.stringify(comRede));
  checa(semRede.length === 5, `sem sinal: a pessoa tinha que tratar os 5 cards que já tinha (tratou ${semRede.length})`,
    semRede.join(' '));
  checa(buscas.length === buscasAntes, 'sem sinal: a busca foi ao servidor sem rede',
    JSON.stringify(buscas.slice(buscasAntes)));
  checa(vazioSemRede.falha && !vazioSemRede.limpo && vazioSemRede.variante === 'states.error.titleOffline',
    'sem sinal: com a fila vazia a tela tinha que ser a de "sem sinal", nunca o "Tudo limpo!"', JSON.stringify(vazioSemRede));
  checa(toastsVermelhos === 0, 'sem sinal: toast de erro pra quem está sem rede tratando o que tem', String(toastsVermelhos));

  await ctx.setOffline(false);
  const voltou = await esperarNaPagina(page, () => {
    const f = document.querySelector('#cardStack .place-card:not(.card-fundo)');
    return !!f && AppState.inFlightActions === 0;
  }, 25000, 200);
  const depois = await tela();
  checa(voltou.ok && depois.card === 'Local V25' && depois.fila === 1,
    'sem sinal: com a rede de volta, o pedido que faltava tinha que aparecer sozinho', JSON.stringify(depois));
  checa(pendentes.length === 1 && decididos.length === 17,
    'sem sinal: as 5 decisões sem rede tinham que chegar ao Waze quando a rede voltou',
    JSON.stringify({ pendentes: pendentes.map((p) => p.updateRequestID), decididos: decididos.length }));
  checa(erros.length === 0, 'fila viva: erro de JS', erros[0]);
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
  // queue[1] e o app passou a baixar foto que ninguém pediu.
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
// tela de entrada aberta: o app pergunta à extensão UMA vez, no carregamento.
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
    // O login de mentira mostra os controles de sessão da Ajuda, como o
    // `showMainScreen` faz: desde 2026-09-26 o "Ver de novo Como funciona" é
    // um deles, e a abertura SEM sessão (como esta página nasce) os esconde.
    mostrarControlesDeSessao(true);
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
  // a pessoa saía do app inteiro. Por isso o teste mede a URL, não o modal.
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
  checa(page.url() === antes, `como funciona: o Esc NAVEGOU pra fora do app (${page.url()})`);
  checa(!(await abertoComoFunciona()), 'como funciona: o Esc não fechou');
  await ctx.close();

  // R6-7-2: com uma camada que a PESSOA abriu enquanto a fila carregava (aqui os
  // Filtros, com uma escolha ainda não aplicada), o primeiro card NÃO abre o
  // aviso por cima — o `openModal` a esconderia e jogaria a escolha fora. Ele
  // espera a camada FECHAR, e abre logo depois, antes de qualquer gesto, como no
  // 1º card (R7-7-01: esperando o "próximo card", ele abria no 1º ✕, debaixo do
  // banner do Desfazer). O CONTROLE é o caso de cima: sem camada, o aviso abre
  // no primeiro card.
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', serviceWorkers: 'block', primeiraVez: true });
  const page2 = await ctx2.newPage();
  await page2.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page2.waitForTimeout(400);
  const camada = await page2.evaluate((p) => {
    AppState.authenticated = true;
    AppState.profile = { id: 1, userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
    AppState.serverTotal = 5; AppState.hasMore = false;
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    renderProfileHeader(); updateStats(); showLoading(false);
    document.getElementById('noMoreCards').classList.add('hidden');
    openModal('filtersModal');
    const unread = document.getElementById('filterUnreadOnly');
    const antes = unread ? unread.checked : null;
    if (unread) unread.checked = !antes;                 // a escolha ainda NÃO aplicada
    AppState.queue = [p, { ...p, venueID: 'v2', updateRequestID: 'u2' }];
    AppState.currentPlace = p;
    document.querySelectorAll('.place-card').forEach((e) => e.remove());
    showCurrentPlace();                                  // o primeiro card chega
    return { filtros: !document.getElementById('filtersModal').classList.contains('hidden'),
             comoFunciona: !document.getElementById('comoFuncionaModal').classList.contains('hidden'),
             escolhaFicou: unread ? unread.checked === !antes : null, visto: AppState.preferences.comoFuncionaVisto };
  }, cru);
  checa(!camada.comoFunciona, 'como funciona: abriu por cima dos Filtros abertos pela pessoa', JSON.stringify(camada));
  checa(camada.filtros && camada.escolhaFicou !== false, 'como funciona: os Filtros (com a escolha não aplicada) sumiram', JSON.stringify(camada));
  checa(!camada.visto, 'como funciona: deu-se por visto sem ter aparecido — nunca mais apareceria', JSON.stringify(camada));
  await page2.evaluate(() => { closeModal('filtersModal'); });
  // Sem card novo nenhum: é o FECHAR da camada que o traz, depois do voltar dela.
  const aposFechar = await esperarNaPagina(page2, () => !document.getElementById('comoFuncionaModal').classList.contains('hidden'), 3000, 50);
  checa(aposFechar.ok, 'como funciona: os Filtros fecharam e o aviso que tinha ficado esperando não apareceu');
  const hist = await page2.evaluate(() => ({ estado: history.state, prof: CamadaVoltar.profundidade, card: AppState.currentPlace && AppState.currentPlace.venueID }));
  checa(hist.estado && hist.estado.wpCamada === 1 && hist.prof === 1,
    'como funciona: a entrada do aviso não ficou no histórico — o voltar do fechamento a comeu (gotcha #65)', JSON.stringify(hist));
  checa(hist.card === cru.venueID, 'como funciona: o aviso só apareceu com outro card (o próximo), e não ao fechar a camada', JSON.stringify(hist));
  await ctx2.close();
}

// ── O "Como funciona" ADIADO: nunca debaixo do banner do Desfazer, nunca no
// tique do voltar (auditoria de 2026-10-02: R7-7-01, R7-7-02 e R7-3-01) ──────
// O adiado (a Ajuda aberta quando o 1º card montou) abria no 1º GESTO: o card
// seguinte monta antes de o `scheduleAction` abrir a janela do Desfazer, e o
// banner (z-70) ficava por cima do "Entendi" — no iPhone SE o toque caía no
// "Desfazer". E fechar a foto ampliada que ANDA a fila (a aprovação pousou com
// ela aberta) o abria no mesmo tique do `history.back()` do fechamento: o voltar
// comia a entrada dele, e o "Entendi" tirava a pessoa do app. Tudo pelo
// `initApp` de verdade, com a fila segurada até a Ajuda estar aberta. A Ajuda é
// fechada pelo VOLTAR do navegador: aí o adiado segue esperando (fechada pelo
// app, ele abre logo depois, e o bloco de cima mede isso).
{
  const SVG_FOTO = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#4b8"/></svg>';
  const FOTO_NOVA = 'data:image/svg+xml;base64,' + Buffer.from(SVG_FOTO).toString('base64');
  const PERFIL_L6 = { id: 12444348, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false, editableCountryIDs: [30], areas: [] };
  const pedido = (n, foto) => ({
    venueID: 'cf' + n, updateRequestID: foto ? 'pendente-0' + n : 'u' + n, name: 'Local ' + n, categories: ['PARK'],
    address: 'Rua ' + n + ', 1', updateTypeKey: foto ? 'IMAGE' : 'VENUE', purType: foto ? 'NEW_PHOTO' : 'NEW_PLACE',
    createdBy: 'fulano' + n, creatorId: 900 + n, creatorRank: 0, lat: -12.9, lon: -38.3, changes: [], mapa: null,
    localAprovado: true, dateAdded: Date.now() - 3600000 * n,
    ...(foto ? { imageUrls: [`${FOTO_NOVA}#pendente-0${n}`, `${FOTO_NOVA}#aprovada-0${n}`], approvedImageIds: ['aprovada-0' + n] } : { imageUrls: [] }),
  });
  const abrirApp = async ({ viewport, toque = false, fotos = false, visto = false, rever = false }) => {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', locale: 'pt-BR', hasTouch: toque, primeiraVez: true });
    await ctx.addInitScript((visto) => {
      try {
        if (sessionStorage.getItem('__cfAdiado')) return;
        sessionStorage.setItem('__cfAdiado', '1');
        localStorage.setItem('waze_session_token', 'token-smoke');
        localStorage.setItem('waze_places_lang', 'pt');
        localStorage.setItem('waze_places_preferences', JSON.stringify(visto ? { undoEnabled: true, comoFuncionaVisto: true } : { undoEnabled: true }));
      } catch (e) { /* armazenamento bloqueado: o teste segue */ }
    }, visto);
    const places = [1, 2, 3].map((n) => pedido(n, fotos));
    let soltar; const busca = new Promise((ok) => { soltar = ok; });
    const envios = [];
    await ctx.route('**/api/**', async (r) => {
      const nome = r.request().url().split('/api/')[1].split(/[?#]/)[0];
      let corpo = { success: true };
      if (nome === 'perfil' || nome === 'testar-cookies') corpo = { success: true, visivelNoWme: true, referencias: null, profile: PERFIL_L6 };
      else if (nome === 'lista-paises') corpo = { success: true, countries: [{ id: 30, name: 'Brazil', abbr: 'BR', env: 'row' }] };
      else if (nome === 'lista-estados') corpo = { success: true, states: [] };
      else if (nome === 'presenca-app') corpo = { success: true, online: [], conversas: [] };
      else if (nome === 'buscar-places') {
        await busca;
        corpo = { success: true, places, hasMore: false, page: 1, total: places.length, totalAll: places.length, blocked: 0 };
      } else if (nome === 'validar-place') envios.push(JSON.parse(r.request().postData() || '{}'));
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) }).catch(() => {});
    });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e.message || e)));
    // A página ANTERIOR do histórico: sair do app aparece na URL.
    await page.goto(BASE + 'manifest.json');
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await esperarOuExplodir(page, () => !!(window.AppState && AppState.authenticated && AppState.profile), 'como funciona adiado: o app não entrou');
    await page.click('#helpBtn');
    await esperarOuExplodir(page, () => !document.getElementById('helpModal').classList.contains('hidden'), 'como funciona adiado: a Ajuda não abriu');
    if (rever) {
      await page.click('#reverComoFunciona');
      await esperarOuExplodir(page, () => (topOpenModal() || {}).id === 'comoFuncionaModal', 'como funciona adiado: o "Ver de novo" não abriu');
    }
    soltar();
    await esperarOuExplodir(page, () => !!AppState.currentPlace && !!document.querySelector('#cardStack .place-card:not(.card-fundo)'), 'como funciona adiado: o 1º card não montou');
    await doisQuadros(page);
    return { ctx, page, erros, envios };
  };
  const aberto = (page) => page.evaluate(() => !document.getElementById('comoFuncionaModal').classList.contains('hidden'));
  // Quantos dos 9 pontos (grade 3×3, quase na borda) do botão NÃO o recebem.
  const cobertos = (page, id) => page.evaluate((id) => {
    const el = document.getElementById(id);
    const r = el.getBoundingClientRect();
    const por = [];
    for (const fx of [0.05, 0.5, 0.95]) for (const fy of [0.05, 0.5, 0.95]) {
      const h = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
      if (!h || !(h === el || el.contains(h))) por.push(!h ? null : h.closest('#undoContainer') ? 'desfazer' : (h.id || String(h.className).split(' ')[0]));
    }
    return por;
  }, id);
  const FRENTE = '#cardStack .place-card:not(.card-fundo)';
  const SE = { width: 320, height: 568 };

  // (1) R7-7-01 pelo TOQUE no iPhone SE: o 1º ✕ não abre o aviso debaixo da
  // janela; ele vem quando ela acaba, com o "Entendi" inteiro alcançável.
  {
    const { ctx, page, erros, envios } = await abrirApp({ viewport: SE, toque: true });
    checa(!(await aberto(page)), 'como funciona adiado: abriu por cima da Ajuda aberta (R6-7-2)');
    await page.goBack();            // o VOLTAR do aparelho fecha a Ajuda
    await doisQuadros(page);
    checa(!(await aberto(page)), 'como funciona adiado: abriu logo depois do voltar do aparelho, sem gesto novo (as entradas ficam puláveis no Chrome)');
    const x = await page.locator(FRENTE + ' .card-btn-reject').boundingBox();
    await page.touchscreen.tap(x.x + x.width / 2, x.y + x.height / 2);
    await esperarOuExplodir(page, () => !!AppState.pendingAction, 'como funciona adiado: o ✕ não abriu a janela do Desfazer');
    await doisQuadros(page);
    checa(!(await aberto(page)), 'como funciona adiado: abriu no 1º ✕, com a janela do Desfazer por cima (o toque no "Entendi" cai no "Desfazer")');
    const fim = await esperarNaPagina(page, () => !AppState.pendingAction && !document.getElementById('comoFuncionaModal').classList.contains('hidden'), 8000, 50);
    checa(fim.ok, 'como funciona adiado: a janela acabou e o aviso que esperava não apareceu');
    const tela = await page.evaluate(() => ({ banner: document.getElementById('undoContainer').children.length }));
    checa(tela.banner === 0, 'como funciona adiado: abriu com o banner do Desfazer na tela', JSON.stringify(tela));
    const pontos = await cobertos(page, 'comoFuncionaOk');
    checa(pontos.length === 0, `como funciona adiado: ${pontos.length}/9 pontos do "Entendi" cobertos`, JSON.stringify(pontos));
    const ok = await page.locator('#comoFuncionaOk').boundingBox();
    await page.touchscreen.tap(ok.x + ok.width / 2, ok.y + ok.height - 4);   // a parte de BAIXO, a que o banner cobria
    await doisQuadros(page);
    const depois = await page.evaluate(() => ({ cf: !document.getElementById('comoFuncionaModal').classList.contains('hidden'),
      rejeitados: AppState.stats.rejected, atual: AppState.currentPlace && AppState.currentPlace.venueID, url: location.pathname }));
    checa(!depois.cf && depois.rejeitados === 1 && depois.atual === 'cf2' && depois.url === '/',
      'como funciona adiado: o "Entendi" não fechou o aviso, ou desfez o ✕', JSON.stringify(depois));
    checa(envios.length === 1, `como funciona adiado: esperava 1 rejeição enviada, veio ${envios.length}`);
    checa(erros.length === 0, 'como funciona adiado: erro de JS', erros[0]);
    await ctx.close();
  }
  // CONTROLE do instrumento: o aviso aberto à força DENTRO da janela, no SE —
  // a grade enxerga o banner por cima do "Entendi" (sem isto, "0 cobertos"
  // passaria com a grade cega).
  {
    const { ctx, page } = await abrirApp({ viewport: SE, toque: true, visto: true });
    await page.goBack(); await doisQuadros(page);
    const x = await page.locator(FRENTE + ' .card-btn-reject').boundingBox();
    await page.touchscreen.tap(x.x + x.width / 2, x.y + x.height / 2);
    await esperarOuExplodir(page, () => !!AppState.pendingAction, 'como funciona adiado (controle): o ✕ não abriu a janela');
    await page.evaluate(() => openModal('comoFuncionaModal'));
    await doisQuadros(page);
    const pontos = await cobertos(page, 'comoFuncionaOk');
    checa(pontos.includes('desfazer'),
      'como funciona adiado (CONTROLE): o aviso aberto na janela não teve o "Entendi" coberto pelo Desfazer — a grade está cega', JSON.stringify(pontos));
    await ctx.close();
  }

  // (2) R7-7-01 pelo TECLADO: Enter no ✕, o aviso vem no fim da janela, e o
  // Enter no "Entendi" devolve o foco ao ✕ do card da frente (o C10) — antes ia
  // pro ⓘ.
  {
    const { ctx, page, erros } = await abrirApp({ viewport: { width: 390, height: 844 } });
    await page.goBack(); await doisQuadros(page);
    await page.focus(FRENTE + ' .card-btn-reject');
    // CONTROLE do instrumento: a leitura do foco enxerga o ✕ da frente.
    checa(await page.evaluate(() => document.activeElement === document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-reject')),
      'como funciona adiado (CONTROLE): a leitura do foco não enxerga o ✕ da frente');
    await page.keyboard.press('Enter');
    await esperarOuExplodir(page, () => !!AppState.pendingAction, 'como funciona adiado: o Enter no ✕ não abriu a janela');
    const fim = await esperarNaPagina(page, () => !AppState.pendingAction && !document.getElementById('comoFuncionaModal').classList.contains('hidden'), 8000, 50);
    checa(fim.ok, 'como funciona adiado (teclado): a janela acabou e o aviso não apareceu');
    await page.focus('#comoFuncionaOk');
    await page.keyboard.press('Enter');
    await doisQuadros(page);
    const foco = await page.evaluate(() => ({ noX: document.activeElement === document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-reject'),
      id: document.activeElement && (document.activeElement.id || String(document.activeElement.className).split(' ')[0]) }));
    checa(foco.noX, 'como funciona adiado (teclado): fechar o aviso não devolveu o foco ao ✕ do card da frente', JSON.stringify(foco));
    checa(erros.length === 0, 'como funciona adiado (teclado): erro de JS', erros[0]);
    await ctx.close();
  }

  // (3) R7-7-02: o "Ver de novo" aberto com a fila carregando dá o aviso por
  // VISTO — o 1º ✕ e o fim da janela não o reabrem.
  {
    const { ctx, page, erros } = await abrirApp({ viewport: { width: 390, height: 844 }, rever: true });
    checa(await page.evaluate(() => AppState.preferences.comoFuncionaVisto === true), 'como funciona: o "Ver de novo" não se deu por visto (R7-7-02)');
    await page.click('#comoFuncionaOk');
    await doisQuadros(page);
    await page.click(FRENTE + ' .card-btn-reject');
    await esperarOuExplodir(page, () => !!AppState.pendingAction, 'como funciona (rever): o ✕ não abriu a janela');
    await esperarOuExplodir(page, () => !AppState.pendingAction, 'como funciona (rever): a janela não acabou', 8000);
    await doisQuadros(page);
    checa(!(await aberto(page)), 'como funciona: o aviso que a pessoa já leu pelo "Ver de novo" reabriu (R7-7-02)');
    checa(erros.length === 0, 'como funciona (rever): erro de JS', erros[0]);
    await ctx.close();
  }

  // (4) R7-3-01: aprovar a foto, esperar a aprovação pousar e FECHAR a foto pelo
  // Esc anda a fila — o aviso vem DEPOIS do voltar do fechamento, a entrada dele
  // fica, e o "Entendi" e o voltar do aparelho ficam no app. CONTROLE: com o
  // aviso já visto, o mesmo caminho fica no app (o caminho em si não sai dele).
  // E a foto fechada pelo VOLTAR do aparelho: o card anda, mas o aviso espera um
  // gesto novo (empilhar ali, sem gesto, deixa as entradas do app "puláveis" no
  // Chrome, e o voltar seguinte sairia dele — o aviso que o próprio navegador dá,
  // medido à parte); ele vem depois do ✕ seguinte, no fim da janela.
  for (const [rotulo, visto, fecha] of [['Entendi', false, 'ok'], ['voltar', false, 'voltar'], ['CONTROLE já visto', true, 'nada'],
    ['foto fechada pelo voltar', false, 'aparelho']]) {
    const { ctx, page, erros } = await abrirApp({ viewport: { width: 412, height: 915 }, fotos: true, visto });
    await page.goBack(); await doisQuadros(page);
    await page.click(FRENTE + ' .card-image');
    await esperarOuExplodir(page, () => Lightbox.isOpen() && document.getElementById('lightboxImage').naturalWidth > 0, `como funciona/foto (${rotulo}): a foto não abriu`);
    await doisQuadros(page);
    await page.click('#lightboxApprove');
    const pousou = await esperarNaPagina(page, () => placeResolvidoPorAprovacao !== null, 10000, 50);
    checa(pousou.ok, `como funciona/foto (${rotulo}): a aprovação não pousou com a foto aberta (a espera estourou)`);
    if (fecha === 'aparelho') {
      await page.goBack();          // o VOLTAR do aparelho fecha a foto: o card anda
      await doisQuadros(page);
      await page.waitForTimeout(300);
      const cedo = await aberto(page);
      checa(!cedo, `como funciona/foto (${rotulo}): o aviso abriu logo depois do voltar do aparelho, sem gesto novo`);
      // Aberto (o defeito), ele cobre o card: o resto não teria o que medir.
      if (cedo) { await ctx.close(); continue; }
      await page.click(FRENTE + ' .card-btn-reject');
      const veio = await esperarNaPagina(page, () => !AppState.pendingAction && !document.getElementById('comoFuncionaModal').classList.contains('hidden'), 8000, 50);
      checa(veio.ok, `como funciona/foto (${rotulo}): depois do gesto e da janela, o aviso adiado não apareceu`);
      await page.click('#comoFuncionaOk');
    } else await page.keyboard.press('Escape');
    if (fecha !== 'nada' && fecha !== 'aparelho') {
      const veio = await esperarNaPagina(page, () => !document.getElementById('comoFuncionaModal').classList.contains('hidden'), 3000, 50);
      checa(veio.ok, `como funciona/foto (${rotulo}): o aviso adiado não apareceu ao fechar a foto`);
      const h = await page.evaluate(() => ({ estado: history.state, prof: CamadaVoltar.profundidade }));
      checa(h.estado && h.estado.wpCamada === 1 && h.prof === 1,
        `como funciona/foto (${rotulo}): a entrada do aviso foi comida pelo voltar do fechamento (gotcha #65)`, JSON.stringify(h));
      if (fecha === 'ok') await page.click('#comoFuncionaOk'); else await page.goBack().catch(() => {});
    }
    await page.waitForTimeout(800);
    // Com `?.`: fora do app (o defeito), a página é a ANTERIOR e não tem o app —
    // a falha sai com o nome e a URL, em vez de derrubar o smoke.
    const fim = await page.evaluate(() => ({ url: location.pathname,
      cf: !!document.getElementById('comoFuncionaModal') && !document.getElementById('comoFuncionaModal').classList.contains('hidden'),
      atual: window.AppState?.currentPlace?.venueID }));
    checa(fim.url === '/' && !fim.cf && fim.atual === (fecha === 'aparelho' ? 'cf3' : 'cf2'),
      `como funciona/foto (${rotulo}): saiu do app (ou o aviso ficou, ou a fila não andou)`, JSON.stringify(fim));
    checa(erros.length === 0, `como funciona/foto (${rotulo}): erro de JS`, erros[0]);
    await ctx.close();
  }
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
  // A extensão só é OFERECIDA onde instala: o Chromium de computador (v2026.09.26-01).
  // O motor do Safari é o caso oposto, e se mede nos dois lados — foi o job do
  // WebKit que achou este bloco clicando num card que, lá, corretamente não existe.
  const oferecida = await page.evaluate(() => document.documentElement.classList.contains('com-extensao'));
  const cardNaTela = await visivel('extInstallLink');
  if (MOTOR === 'chromium') {
    checa(oferecida && cardNaTela, 'extensão: NÃO oferecida no Chromium de computador, onde ela instala');
  } else {
    checa(!oferecida && !cardNaTela, `extensão: oferecida no ${MOTOR}, onde ela não instala`);
  }
  if (!pularForaDoChromium(MOTOR, 'extensão: o "Já instalei — entrar" depois de ir à loja',
    'a extensão só existe no Chromium de computador; fora dele o card nem aparece (conferido acima)')) {
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
  }
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
//
// E o FIM do treino fecha por quatro caminhos, um por idioma: por Esc, pelo
// fundo ou pelo voltar do aparelho o treino ficava PRESO — o card de treino já
// tratado na tela, "Restam 0" e os botões mortos (auditoria de 2026-09-29, A5).
const FECHAR_FIM_DO_TREINO = { pt: 'botão', en: 'Esc', es: 'voltar', fr: 'fundo' };
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
  // O placar do treino é DELE (Treino.stats/restam): a TELA mostra o dele e o
  // real fica intacto por baixo. Trocar o `AppState.stats` (como era) fazia a
  // resposta de uma ação real, pousando no treino, gravar o número do treino.
  const placar = await page.evaluate(() => ({
    tela: { restam: document.getElementById('pendingCount').textContent.trim(), lidos: document.getElementById('readCount').textContent.trim() },
    treino: { restam: Treino.restam, lidos: Treino.stats.read },
    real: { restam: AppState.serverTotal, lidos: AppState.stats.read },
  }));
  checa(placar.tela.restam === '3' && placar.tela.lidos === '0' && placar.treino.restam === 3
    && placar.real.restam === 99 && placar.real.lidos === 7,
    `treino ${lg}: o placar do treino não é separado do real`, JSON.stringify(placar));

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

  const caminho = FECHAR_FIM_DO_TREINO[lg] || 'botão';
  if (caminho === 'Esc') await page.keyboard.press('Escape');
  else if (caminho === 'voltar') await page.goBack().catch(() => {});
  else if (caminho === 'fundo') await page.mouse.click(4, 4);   // o scrim, fora do cartão centrado
  else await page.click('#treinoFimOk');
  await page.waitForTimeout(700);
  const dep = await page.evaluate(() => ({
    modalFechado: document.getElementById('treinoFimModal').classList.contains('hidden'),
    treinoAtivo: Treino.ativo,
    banner: document.getElementById('treinoBanner').classList.contains('hidden'),
    fila: AppState.queue.length, atual: (AppState.currentPlace || {}).venueID,
    cardNaTela: cardDaFrente() && cardDaFrente().querySelector('.card-name')?.textContent.trim(),
    restam: document.getElementById('pendingCount').textContent.trim(),
    total: AppState.serverTotal, read: AppState.stats.read,
  }));
  // PRÉ-CONDIÇÃO: o caminho FECHOU o modal — senão "o treino ficou ativo" mediria o clique que errou.
  checa(dep.modalFechado, `treino ${lg}: o fim do treino não fechou pelo ${caminho}`, JSON.stringify(dep));
  checa(!dep.treinoAtivo && dep.banner && dep.fila === 1 && dep.atual === 'real1' && dep.cardNaTela === 'Local Real'
    && dep.total === 99 && dep.read === 7,
  `treino ${lg}: fechado pelo ${caminho}, a fila real não voltou intacta (treino preso?)`, JSON.stringify(dep));
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
        // R10-7-01: a fila real é VAZIA aqui, então o card é um exemplo
        // SINTÉTICO — sem lugar no mapa, e o ↗ dele abria o WME sem nada
        // selecionado. Ele sai da TELA (não só ganha a classe: o CSS poderia
        // vencer o `hidden`, gotcha #27). O CONTROLE, o ↗ do clone de um pedido
        // real na tela, está no bloco seguinte.
        linkDoExemplo: (() => {
          const a = document.querySelector('#cardStack .place-card:not(.card-fundo) .card-wme-link');
          return { exemplo: AppState.currentPlace && AppState.currentPlace._exemplo, existe: !!a,
            naTela: !!a && a.getClientRects().length > 0, href: a ? a.getAttribute('href') : null };
        })(),
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
    checa(!!m.linkDoExemplo.exemplo && m.linkDoExemplo.existe,
      `${onde}: PRÉ-CONDIÇÃO — o card da frente não é um exemplo sintético com o ↗ no DOM`, JSON.stringify(m.linkDoExemplo));
    checa(!m.linkDoExemplo.naTela && m.linkDoExemplo.href === null,
      `${onde}: o ↗ do exemplo sintético está na tela — ele abre o WME sem nada selecionado (R10-7-01)`, JSON.stringify(m.linkDoExemplo));
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
  // O MESMO autor nos três: a folha dele (R9-7-05, abaixo) tem lote a oferecer.
  const reais = FIXTURES_PAISES.filter((p) => (p.imageUrls || []).length).slice(0, 3).map((p, i) => ({
    ...p, lat: -23.55 + i * 0.01, lon: -46.63 + i * 0.01,
    imageUrls: ['https://venue-image.waze.com/thumbs/thumb700_foto' + i],
    approvedImageIds: ['foto' + i],
    creatorId: 777, createdBy: 'spam',
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
    // E o ↗ do clone segue NA TELA, com o lugar dele: o CONTROLE do exemplo
    // sintético, que fica sem o ↗ (R10-7-01, no bloco da tela do treino) — prova
    // que aquela medida enxerga um ↗ que existe.
    const linkDoClone = await page.evaluate(() => {
      const a = document.querySelector('#cardStack .place-card:not(.card-fundo) .card-wme-link');
      return { venue: AppState.currentPlace && AppState.currentPlace.venueID,
        naTela: !!a && a.getClientRects().length > 0, href: a ? a.getAttribute('href') : null };
    });
    checa(linkDoClone.naTela && (linkDoClone.href || '').includes('venues=' + encodeURIComponent(linkDoClone.venue) + '&'),
      `${onde}: CONTROLE — o ↗ do clone de um pedido real não está na tela com o lugar dele (a medida do exemplo sintético estaria cega)`,
      JSON.stringify(linkDoClone));

    // A FOLHA DO AUTOR (o selo "✕ N") num card de TREINO (R9-7-05, auditoria de
    // 2026-10-06): ela oferecia o "Rejeitar os N", o "Esquecer" e o interruptor
    // da recusa automática — que ARMAVA rejeições de verdade pra depois do
    // treino. No treino ela não oferece o que escreve, como a lixeira (abaixo). A
    // CONTRAPROVA é a mesma folha fora do treino, redesenhada SEM fechar (fechar
    // e abrir no mesmo tique é o gotcha #65).
    const folha = await page.evaluate(() => {
      const ids = () => [...document.querySelectorAll('#autorCorpo [id]')].map((e) => e.id).sort().join(',');
      abrirFolhaDoAutor(AppState.currentPlace);
      const noTreino = { aberta: !document.getElementById('autorModal').classList.contains('hidden'), ids: ids() };
      const era = Treino.ativo; Treino.ativo = false;
      abrirFolhaDoAutor(AppState.currentPlace);
      const fora = ids();
      Treino.ativo = era;
      closeModal('autorModal');
      return { noTreino, fora };
    });
    checa(folha.fora === 'autorAuto,autorEsquecer,autorRejeitar,autorVer',
      `${onde}: CONTRAPROVA falhou — fora do treino a folha não tem as quatro linhas, então "sumiu" não prova nada`, folha.fora);
    checa(folha.noTreino.aberta && folha.noTreino.ids === 'autorVer',
      `${onde}: a folha do autor no treino oferece o que ESCREVE (o interruptor arma a recusa automática de verdade)`,
      JSON.stringify(folha.noTreino));
    // O `history.back()` do fechamento termina antes da próxima camada abrir.
    await esperarNaPagina(page, () => !CamadaVoltar.consumindo, 3000);

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

// ── Treino: o "Sair" pelo TECLADO leva o foco ao ✕ do card real ──────────
// O "Sair" some com a faixa do treino e o card real volta: pelo teclado, o foco
// caía no <body> (R7-2-06, MEDIDO no Chromium e no WebKit; auditoria de
// 2026-10-02), e quem usa teclado ou leitor de tela recomeçava do topo da
// página. A regra do C10 pra todo controle que some com o foco: ele vai ao ✕ do
// card que volta (`prometerFocoAoCardQueVem`). O CONTROLE é o mouse — o foco não
// é movido —, e a PRÉ-CONDIÇÃO é o Enter cair no "Sair" focado: sem ela, "o foco
// não foi pro ✕" mediria uma tecla que nem chegou ao botão.
for (const como of ['teclado', 'mouse']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('waze_places_preferences',
    JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true })));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    API.setSession('token-de-teste');
    AppState.authenticated = true;
    AppState.profile = { id: 1, userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
    AppState.serverTotal = 2; AppState.hasMore = false;
    const real = (i) => ({ venueID: 'real' + i, updateRequestID: 'r' + i, name: 'Local Real ' + i,
      categories: ['OTHER'], address: 'Rua Real, ' + i, updateType: 'Novo Local', updateTypeKey: 'VENUE',
      purType: 'NEW_PLACE', reqType: 'VENUE', createdBy: 'x', changes: [], imageUrls: [], mapa: null, dateAdded: Date.now() });
    AppState.queue = [real(1), real(2)];
    AppState.currentPlace = AppState.queue[0];
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    renderProfileHeader(); updateStats(); showLoading(false);
    document.getElementById('noMoreCards').classList.add('hidden');
    showCurrentPlace();
    Treino.entrar();
  });
  await esperarNaPagina(page, () => Treino.ativo && !document.getElementById('treinoBanner').classList.contains('hidden'), 5000);
  let focado = null;
  if (como === 'teclado') {
    await page.focus('#treinoSairBtn');
    focado = await page.evaluate(() => document.activeElement && document.activeElement.id);
    await page.keyboard.press('Enter');
  } else {
    await page.click('#treinoSairBtn');
  }
  // Espera o FIM (o card real de volta na tela), nunca um prazo; o foco
  // prometido pousa logo depois de o card ser desenhado.
  const voltou = await esperarNaPagina(page, () => !Treino.ativo && !!cardDaFrente()
    && AppState.currentPlace && AppState.currentPlace.updateRequestID === 'r1', 5000);
  if (como === 'teclado') {
    await esperarNaPagina(page, () => !!document.activeElement && document.activeElement.classList.contains('card-btn-reject'), 3000);
  } else {
    await doisQuadros(page);
  }
  const r = await page.evaluate(() => {
    const a = document.activeElement;
    return { treino: Treino.ativo, frente: AppState.currentPlace && AppState.currentPlace.updateRequestID,
      foco: !a || a === document.body ? 'body' : (a.id || String(a.className).split(' ')[0]),
      noCardDaFrente: !!(a && cardDaFrente() && cardDaFrente().contains(a)) };
  });
  const onde = `treino, "Sair" pelo ${como}`;
  checa(voltou.ok && !r.treino && r.frente === 'r1', `${onde}: PRÉ-CONDIÇÃO — o card real não voltou`, JSON.stringify(r));
  if (como === 'teclado') {
    checa(focado === 'treinoSairBtn', `${onde}: PRÉ-CONDIÇÃO — o "Sair" não estava com o foco antes do Enter (${focado})`);
    checa(r.foco === 'card-btn-reject' && r.noCardDaFrente,
      `${onde}: a faixa sumiu e o foco ficou em ${r.foco} — quem usa teclado recomeça do topo`, JSON.stringify(r));
  } else {
    checa(!r.noCardDaFrente, `${onde}: CONTROLE — o mouse moveu o foco pro card (${r.foco})`, JSON.stringify(r));
  }
  await ctx.close();
}

// ── Treino: o FIM e o "Quero treinar antes" pelo TECLADO, o foco no ✕ ────
// Os irmãos do "Sair" de cima: controles do treino que somem com o foco
// (auditoria de 2026-10-03, MEDIDO no Chromium e no WebKit).
//   R8-7-07 — o fim do treino fechado pelo teclado (Enter no "Ir para a fila",
//             Esc) devolvia o foco a quem abriu o diálogo, o ✓ do último card
//             de TREINO, que saiu com ele: caía no ⓘ do topo. Vai ao ✕ do card
//             real que volta;
//   R8-7-08 — o "Quero treinar antes" pelo teclado devolvia o foco ao ✕ do card
//             REAL, que o treino troca logo em seguida: caía no <body>. Vai ao ✕
//             do card de treino.
// E os da rodada 10 (auditoria de 2026-10-07): o "Entendi" e o Esc do "Como
// funciona" que abre sozinho (R10-7-03) e o "Praticar" da Ajuda (R10-7-04) pelo
// teclado caíam no ⓘ do topo. Vão ao ✕ do card.
// Os CONTROLES: o mouse (o foco não pula pro card) e o "Entendi" pelo mouse no
// que abre sozinho (o foco vai à reserva, o ⓘ — prova que a medida enxerga o
// fechamento devolvendo o foco). A PRÉ-CONDIÇÃO de cada Enter é cair no botão
// focado.
{
  const montar = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem('waze_places_preferences',
      JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true })));
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      API.setSession('token-de-teste');
      AppState.authenticated = true;
      AppState.profile = { id: 1, userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
      AppState.serverTotal = 2; AppState.hasMore = false;
      const real = (i) => ({ venueID: 'real' + i, updateRequestID: 'r' + i, name: 'Local Real ' + i,
        categories: ['OTHER'], address: 'Rua Real, ' + i, updateType: 'Novo Local', updateTypeKey: 'VENUE',
        purType: 'NEW_PLACE', reqType: 'VENUE', createdBy: 'x', changes: [], imageUrls: [], mapa: null, dateAdded: Date.now() });
      AppState.queue = [real(1), real(2)];
      AppState.currentPlace = AppState.queue[0];
      document.getElementById('authScreen').classList.add('hidden');
      document.getElementById('appScreen').classList.remove('hidden');
      renderProfileHeader(); updateStats(); showLoading(false);
      document.getElementById('noMoreCards').classList.add('hidden');
      showCurrentPlace();
    });
    return { ctx, page };
  };
  const foco = (page) => page.evaluate(() => {
    const a = document.activeElement;
    return { treino: Treino.ativo, frente: AppState.currentPlace && AppState.currentPlace.updateRequestID,
      deTreino: !!(AppState.currentPlace && AppState.currentPlace._treino),
      foco: !a || a === document.body ? 'body' : (a.id || String(a.className).split(' ')[0]),
      noCardDaFrente: !!(a && cardDaFrente() && cardDaFrente().contains(a)) };
  });
  const focadoAgora = (page) => page.evaluate(() => document.activeElement && document.activeElement.id);
  const focoNoX = (page) => esperarNaPagina(page,
    () => !!document.activeElement && document.activeElement.classList.contains('card-btn-reject'), 3000);

  // R8-7-07: o treino inteiro pelo teclado (Enter no ✓ de cada card) até o fim.
  for (const como of ['Enter', 'Esc', 'mouse']) {
    const { ctx, page } = await montar();
    const onde = `treino, o fim fechado pelo ${como}`;
    await page.evaluate(() => Treino.entrar());
    let passos = 0;
    for (let i = 0; i < 10; i++) {
      const fim = await page.evaluate(() => !document.getElementById('treinoFimModal').classList.contains('hidden'));
      if (fim) break;
      // O FIM de cada passo, nunca um prazo: o `agir` conta o passo e monta o
      // card seguinte (ou abre o diálogo do fim) na mesma tarefa. A marca vai
      // NA PÁGINA — a função da espera é serializada, sem as variáveis daqui.
      await page.evaluate(() => { window.__passoAntes = Treino.passo; });
      await page.focus('#cardStack .place-card:not(.card-fundo) .card-btn-read');
      await page.keyboard.press('Enter');
      passos++;
      await esperarNaPagina(page, () => Treino.passo > window.__passoAntes, 3000);
    }
    const abriu = await esperarNaPagina(page, () => !document.getElementById('treinoFimModal').classList.contains('hidden'), 3000);
    checa(abriu.ok, `${onde}: PRÉ-CONDIÇÃO — o "Treino concluído" não abriu (${passos} passos)`);
    let focado = null;
    if (como === 'Enter') {
      await page.focus('#treinoFimOk');
      focado = await focadoAgora(page);
      await page.keyboard.press('Enter');
    } else if (como === 'Esc') {
      await page.keyboard.press('Escape');
    } else {
      await page.click('#treinoFimOk');
    }
    const voltou = await esperarNaPagina(page, () => !Treino.ativo && !!cardDaFrente()
      && AppState.currentPlace && AppState.currentPlace.updateRequestID === 'r1', 5000);
    if (como !== 'mouse') await focoNoX(page);
    else await doisQuadros(page);
    const r = await foco(page);
    checa(voltou.ok && !r.treino && r.frente === 'r1', `${onde}: PRÉ-CONDIÇÃO — o card real não voltou`, JSON.stringify(r));
    if (como === 'Enter') checa(focado === 'treinoFimOk', `${onde}: PRÉ-CONDIÇÃO — o Enter não caiu no "Ir para a fila" focado (${focado})`);
    if (como === 'mouse') {
      checa(!r.noCardDaFrente, `${onde}: CONTROLE — o mouse moveu o foco pro card (${r.foco})`, JSON.stringify(r));
    } else {
      checa(r.foco === 'card-btn-reject' && r.noCardDaFrente,
        `${onde}: o diálogo fechou e o foco ficou em ${r.foco} — quem usa teclado recomeça da Ajuda`, JSON.stringify(r));
    }
    await ctx.close();
  }

  // R8-7-08: o "Como funciona" aberto com o foco guardado no ✕ do card real (o
  // adiado, R7-7-01), e o Enter no "Quero treinar antes" / no "Entendi".
  // R9-7-03: e o que abre SOZINHO no 1º card, sem nada focado antes. O
  // fechamento devolvia o foco à reserva, o ⓘ do topo — um controle vivo, e o
  // foco prometido ao card de treino desistia dele: o Enter seguinte reabria a
  // Ajuda. R10-7-03: o "Entendi" e o Esc ali também caíam no ⓘ (MEDIDO no
  // Chromium e no WebKit; auditoria de 2026-10-07), e vão agora ao ✕ do card na
  // tela. O CONTROLE de que a medida enxerga o fechamento devolvendo o foco é o
  // "Entendi" pelo MOUSE, que segue indo à reserva, o ⓘ (R6-1-07).
  const COMO_FUNCIONA = {
    Treinar: 'Enter no "Quero treinar antes"', Entendi: 'Enter no "Entendi"', mouse: 'o mouse no "Quero treinar antes"',
    TreinarSozinho: 'Enter no "Quero treinar antes"', EntendiSozinho: 'Enter no "Entendi"', EscSozinho: 'o Esc',
    mouseEntendiSozinho: 'o mouse no "Entendi"',
  };
  for (const [como, gesto] of Object.entries(COMO_FUNCIONA)) {
    const { ctx, page } = await montar();
    const sozinho = como.endsWith('Sozinho');
    const peloMouse = como.startsWith('mouse');
    const onde = `"Como funciona"${sozinho ? ' que abre sozinho' : ''}, ${gesto}`;
    const antes = await page.evaluate((sozinho) => {
      if (!sozinho) cardDaFrente().querySelector('.card-btn-reject').focus();
      else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      const a = document.activeElement;
      abrirComoFunciona();
      return !a || a === document.body ? 'body' : (a.id || String(a.className).split(' ')[0]);
    }, sozinho);
    if (sozinho) checa(antes === 'body', `${onde}: PRÉ-CONDIÇÃO — havia foco antes do diálogo (${antes})`);
    const botao = /Entendi/.test(como) ? 'comoFuncionaOk' : 'comoFuncionaTreinar';
    let focado = null;
    if (peloMouse) {
      await page.click('#' + botao);
    } else if (como === 'EscSozinho') {
      await page.keyboard.press('Escape');
    } else {
      await page.focus('#' + botao);
      focado = await focadoAgora(page);
      await page.keyboard.press('Enter');
    }
    const fechou = await esperarNaPagina(page, () => document.getElementById('comoFuncionaModal').classList.contains('hidden')
      && !!cardDaFrente(), 3000);
    if (como === 'mouseEntendiSozinho') { await esperarNaPagina(page, () => document.activeElement && document.activeElement.id === 'helpBtn', 3000); }
    else if (!peloMouse) await focoNoX(page);
    else { await esperarNaPagina(page, () => Treino.ativo, 3000); await doisQuadros(page); }
    const r = await foco(page);
    checa(fechou.ok, `${onde}: PRÉ-CONDIÇÃO — o diálogo não fechou`, JSON.stringify(r));
    if (!peloMouse && como !== 'EscSozinho') checa(focado === botao, `${onde}: PRÉ-CONDIÇÃO — o Enter não caiu no botão focado (${focado})`);
    if (como === 'Entendi') {
      checa(!r.treino && r.foco === 'card-btn-reject' && r.noCardDaFrente,
        `${onde}: o foco não voltou ao ✕ do card real, que abriu o diálogo (${r.foco})`, JSON.stringify(r));
    } else if (como === 'EntendiSozinho' || como === 'EscSozinho') {
      checa(!r.treino && r.foco === 'card-btn-reject' && r.noCardDaFrente,
        `${onde}: o foco ficou em ${r.foco}, e não no ✕ do card — no ⓘ do topo, o Enter seguinte reabre a Ajuda`, JSON.stringify(r));
    } else if (como === 'mouseEntendiSozinho') {
      checa(!r.treino && r.foco === 'helpBtn',
        `${onde}: CONTROLE — o foco não foi à reserva, o ⓘ (${r.foco}): a medida não enxerga o fechamento devolvendo o foco`, JSON.stringify(r));
    } else if (como.startsWith('Treinar')) {
      checa(r.treino && r.deTreino, `${onde}: PRÉ-CONDIÇÃO — o treino não abriu`, JSON.stringify(r));
      checa(r.foco === 'card-btn-reject' && r.noCardDaFrente,
        `${onde}: o foco ficou em ${r.foco}, e não no ✕ do card de treino`, JSON.stringify(r));
    } else {
      checa(r.treino && !r.noCardDaFrente, `${onde}: CONTROLE — o mouse moveu o foco pro card (${r.foco})`, JSON.stringify(r));
    }
    await ctx.close();
  }

  // R10-7-04: o "Praticar" da Ajuda pelo teclado (Enter no ⓘ, Enter no
  // "Praticar") deixava o foco no ⓘ, e o Enter seguinte reabria a Ajuda — os
  // dois botões que abrem o treino levavam o foco a lugares diferentes (MEDIDO no
  // Chromium e no WebKit; auditoria de 2026-10-07). Vai ao ✕ do 1º card de
  // treino. CONTROLE: pelo mouse, o foco não pula pro card.
  for (const peloTeclado of [true, false]) {
    const { ctx, page } = await montar();
    const onde = `"Praticar" na Ajuda, ${peloTeclado ? 'pelo teclado' : 'pelo mouse'}`;
    // Os controles da Ajuda que só existem com sessão (o `showMainScreen` os mostra).
    await page.evaluate(() => mostrarControlesDeSessao(true));
    let focado = null;
    if (peloTeclado) {
      await page.focus('#helpBtn');
      await page.keyboard.press('Enter');
    } else {
      await page.click('#helpBtn');
    }
    const ajuda = await esperarNaPagina(page, () => !document.getElementById('helpModal').classList.contains('hidden'), 3000);
    checa(ajuda.ok, `${onde}: PRÉ-CONDIÇÃO — a Ajuda não abriu`);
    if (peloTeclado) {
      await page.focus('#abrirTreino');
      focado = await focadoAgora(page);
      await page.keyboard.press('Enter');
      await focoNoX(page);
    } else {
      await page.click('#abrirTreino');
      await esperarNaPagina(page, () => Treino.ativo, 3000);
      await doisQuadros(page);
    }
    const r = await foco(page);
    checa(r.treino && r.deTreino, `${onde}: PRÉ-CONDIÇÃO — o treino não abriu`, JSON.stringify(r));
    if (peloTeclado) {
      checa(focado === 'abrirTreino', `${onde}: PRÉ-CONDIÇÃO — o Enter não caiu no "Praticar" focado (${focado})`);
      checa(r.foco === 'card-btn-reject' && r.noCardDaFrente,
        `${onde}: o foco ficou em ${r.foco}, e não no ✕ do card de treino — no ⓘ do topo, o Enter seguinte reabre a Ajuda`, JSON.stringify(r));
    } else {
      checa(!r.noCardDaFrente, `${onde}: CONTROLE — o mouse moveu o foco pro card (${r.foco})`, JSON.stringify(r));
    }
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
  await presencaViva(ctx);   // a lista da presença sai no showMainScreen (ver o `presencaViva`)
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


// ── Ponto no ícone do app instalado ─────────────────────────────────────
// Espiona `setAppBadge`/`clearAppBadge` em vez de depender do sistema: o badge
// de verdade só existe com o app INSTALADO, e o que este projeto controla é
// QUANDO chama e COM O QUÊ. Três coisas que quebram calado se alguém mexer:
//   1. mandar NÚMERO em vez de ponto — o badge só é escrito quando o app roda,
//      então um número fica velho no instante em que ele fecha;
//   2. PEDIR permissão de notificação — prompt não solicitado é a interrupção
//      que a régua do projeto proíbe, e no iOS é o que o badge exigiria;
//   3. deixar a promessa REJEITADA escapar — no iOS sem permissão ela rejeita,
//      e um "unhandled rejection" por sessão é ruído que mascara erro real.
for (const suporte of [true, false]) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'pt-BR', serviceWorkers: 'block' });
  await presencaViva(ctx);   // a lista da presença sai no showMainScreen (ver o `presencaViva`)
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
      `${onde}: mandou NÚMERO — ele fica velho assim que o app fecha`, JSON.stringify(r1));
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
//   1. o limiar errar pro lado da folga — aparecer com muito prazo vira ruído —,
//      e o DIA na tela não ser o dia em que ela vence (a conta é de DATA: às
//      20h com 20 h de prazo é "amanhã", e o `floor` de 24 h dizia "hoje");
//   2. sobreviver ao logout ou ao prazo já vencido — a frase passaria a falar
//      de uma sessão que não existe mais;
//   3. estourar a caixa em francês, que é a língua mais larga (gotcha #25), no
//      aparelho mais estreito;
//   4. virar alvo de toque pequeno logo acima da área de swipe.
//
// O relógio da PÁGINA fica parado às 20h de hoje (`page.clock.setFixedTime`):
// com a conta por data, "falta 1,4 dia" cai amanhã ou depois de amanhã conforme
// a hora em que o smoke roda, e sem relógio fixo o bloco reprovaria só em
// certas horas do dia (falha intermitente ensina a ignorar o CI). As 20h são o
// caso do defeito, e os prazos saem daqui, nunca do relógio de agora.
const AGORA_AVISO = (() => { const d = new Date(); d.setHours(20, 0, 0, 0); return d.getTime(); })();
const DIAS = (d) => Math.floor(AGORA_AVISO / 1000) + Math.round(d * 86400);
const DIA_AS = (n, h, m = 0) => {
  const d = new Date(AGORA_AVISO);
  d.setDate(d.getDate() + n);
  d.setHours(h, m, 0, 0);
  return Math.floor(d.getTime() / 1000);
};
for (const [aparelho, viewport] of [['Galaxy Fold', { width: 280, height: 653 }], ['Pixel 7', { width: 412, height: 915 }]]) {
  for (const lang of LINGUAS) {
    const ctx = await browser.newContext({ viewport, locale: lang === 'en' ? 'en-US' : lang, serviceWorkers: 'block' });
    await presencaViva(ctx);   // a lista da presença sai no showMainScreen (ver o `presencaViva`)
    const page = await ctx.newPage();
    await page.clock.setFixedTime(AGORA_AVISO);
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
      const out = { _frases: { hoje: t('sessao.vence.hoje'), amanha: t('sessao.vence.amanha') } };
      for (const [rot, quando] of Object.entries(prazos)) {
        AppState.authenticated = rot !== 'deslogado';
        AppState.sessaoExpiraEm = quando;
        updatePendingCount();
        out[rot] = { visivel: ver(), txt: el().textContent };
      }
      AppState.authenticated = true;
      return out;
    }, {
      '10 dias': DIAS(10), '5º dia': DIA_AS(5, 12), '6º dia': DIA_AS(6, 1),
      'depois de amanhã': DIAS(1.4), amanhã: DIAS(20 / 24), hoje: DIAS(3 / 24),
      vencido: DIAS(-0.5), deslogado: DIAS(2), 'sem prazo': null,
    });
    for (const rot of ['10 dias', '6º dia', 'vencido', 'deslogado', 'sem prazo']) {
      checa(!estados[rot].visivel, `${onde}: apareceu com "${rot}"`, estados[rot].txt);
    }
    for (const rot of ['5º dia', 'depois de amanhã', 'amanhã', 'hoje']) {
      checa(estados[rot].visivel, `${onde}: NÃO apareceu com "${rot}"`);
      checa(!/[{}]|undefined|NaN/.test(estados[rot].txt),
        `${onde}: placeholder cru na frase de "${rot}"`, estados[rot].txt);
    }
    // O dia na tela é o dia em que ela vence: 20 h de prazo às 20h é AMANHÃ (o
    // defeito dizia "hoje"), 3 h é hoje, e 1,4 dia é depois de amanhã, de madrugada.
    checa(estados.hoje.txt === estados._frases.hoje, `${onde}: 3 h de prazo às 20h não disse "hoje"`, estados.hoje.txt);
    checa(estados['amanhã'].txt === estados._frases.amanha, `${onde}: 20 h de prazo às 20h não disse "amanhã"`, estados['amanhã'].txt);
    checa(/(^|\D)2(\D|$)/.test(estados['depois de amanhã'].txt), `${onde}: 1,4 dia às 20h não disse "2 dias"`, estados['depois de amanhã'].txt);
    checa(/(^|\D)5(\D|$)/.test(estados['5º dia'].txt), `${onde}: o quinto dia não disse "5 dias"`, estados['5º dia'].txt);

    // Cabe na caixa, não é alvo de toque, e não tapa nada.
    //
    // O `visivel` não é zelo: o laço acima termina em "sem prazo", que ESCONDE o
    // aviso, e medir elemento escondido dá caixa 0×0 em (0,0) — que "estoura"
    // o pai pela esquerda e cai fora do `elementFromPoint`. Reprovou 16 de 16,
    // em aparelho e idioma onde a medição manual dava limpo: achado que acusa
    // tudo é o instrumento, não o app (gotcha #28).
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
  await presencaViva(ctx);   // a lista da presença sai no showMainScreen (ver o `presencaViva`)
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
    // Compara DÍGITOS: o "Restam" sai no locale de quem lê (1.234 / 1,234 /
    // 1 234), e casar a string inteira só funcionaria enquanto a fila do treino
    // tivesse 3 dígitos — que é o teto de hoje, não uma garantia.
    checa(String(m.cards) === String(m.restam).replace(/\D/g, ''),
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
// Ela é a imagem mais pesada do app (214 KB, medido na produção) e aparece com
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
    // Sessão VIVA pra lista da presença. Sem isto o WebKit, que não tem
    // `requestIdleCallback`, pedia o avatar 800 ms depois da tela pronta — com
    // a sessão já caída pelo 401 da presença — e o bloco acusava "a foto NUNCA
    // chegou". No Chromium passava por sorte de tempo (gotcha #62).
    await presencaViva(ctx);
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
    // PREMISSA antes do veredito: o avatar só sai com a sessão de pé (o
    // `carregar` confere `authenticated`). Sessão caída no meio faz o "NUNCA
    // chegou" abaixo acusar o avatar pelo que é defeito da fixture.
    checa(await page.evaluate(() => AppState.authenticated === true),
      `${onde}: a sessão caiu no meio do bloco — o que falhou foi a fixture, não o avatar`);
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
// script, e o sintoma é sutil: o app abre no esquema errado por um instante e
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

// ── O tema trocado pelo BOTÃO pinta o que a RECARGA pinta ───────────────
// Auditoria de 2026-09-29 (A8), medido: com o sistema escuro, tocar pro claro
// deixava a barra do sistema (a meta `theme-color` que VALE) e o fundo sob o
// app ESCUROS até recarregar — o botão não punha o `tema-claro` e só mudava a
// PRIMEIRA meta. O test/tema.test.mjs compara classes e metas; aqui é a TELA:
// o fundo computado do <html> e do <body> e a meta que casa com a media do
// sistema, depois de cada toque e depois da recarga, nos dois sistemas. E a
// sentinela do diagnóstico: calada com o tema certo, e ALERTANDO no estado que
// o botão deixava (recriado à mão, o CONTROLE de que ela enxerga).
let temaMedidas = 0;
for (const sistema of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block', colorScheme: sistema });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const medir = () => page.evaluate(() => {
    const vale = [...document.querySelectorAll('meta[name="theme-color"]')]
      .find((m) => !m.media || matchMedia(m.media).matches);
    let alerta;
    try { alerta = diagSentinelas(diagComputado()).some((a) => a.chave === 'temaContraditorio'); } catch (e) { alerta = 'erro: ' + e.message; }
    return {
      escuro: document.documentElement.classList.contains('dark'),
      fundoHtml: getComputedStyle(document.documentElement).backgroundColor,
      fundoBody: getComputedStyle(document.body).backgroundColor,
      barra: vale ? vale.getAttribute('content') : null,
      alerta,
    };
  });
  for (const passo of ['1º toque', '2º toque']) {
    const antes = await medir();
    await page.click('#themeBtn');
    await page.waitForTimeout(250);
    const toque = await medir();
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    const recarga = await medir();
    temaMedidas++;
    const onde = `tema · sistema ${sistema}, ${passo}`;
    checa(toque.escuro !== antes.escuro, `${onde}: o botão não trocou o tema (CONTROLE)`, JSON.stringify({ antes, toque }));
    checa(JSON.stringify(toque) === JSON.stringify(recarga),
      `${onde}: o botão pinta diferente da recarga — barra ou fundo só acertam recarregando`,
      `toque ${JSON.stringify(toque)} · recarga ${JSON.stringify(recarga)}`);
    checa(toque.barra === (toque.escuro ? '#0f172a' : '#f8fafc'), `${onde}: a barra do sistema não acompanha o tema`, JSON.stringify(toque));
    checa(toque.alerta === false, `${onde}: a sentinela do tema alertou (ou não rodou) com o tema certo`, JSON.stringify(toque));
  }
  if (sistema === 'dark') {
    // O estado que o botão deixava: app claro SEM `tema-claro`, barra escura.
    const quebrado = await page.evaluate(() => {
      document.documentElement.classList.remove('dark', 'tema-claro');
      document.body.classList.remove('dark');
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', '#0f172a'));
      return {
        fundoHtml: getComputedStyle(document.documentElement).backgroundColor,
        alerta: diagSentinelas(diagComputado()).some((a) => a.chave === 'temaContraditorio'),
      };
    });
    checa(quebrado.fundoHtml === 'rgb(15, 23, 42)',
      'tema · CONTROLE: sem `tema-claro` num sistema escuro o fundo tinha que ficar escuro — a medida não enxerga o defeito',
      JSON.stringify(quebrado));
    checa(quebrado.alerta === true, 'tema · a sentinela do diagnóstico NÃO viu o app claro sobre o fundo escuro', JSON.stringify(quebrado));
  }
  checa(erros.length === 0, `tema · sistema ${sistema}: erro de JS`, erros[0]);
  await ctx.close();
}

// ── Conectar outro aparelho: o QR VENCIDO não oferece o que não vale ─────
// Auditoria de 2026-09-29 (A15), medido: vencido o QR, a tela seguia com
// "Aponte a câmera…" sobre um QR apagado e com o "Sem câmera? Mostrar um
// código" — que criava um código NOVO, válido, embaixo de "Código expirado —
// feche e toque de novo". Aqui o QR vence em 2 s e se mede o que está VISÍVEL
// (não a classe); e o código curto pedido ANTES vence no prazo DELE, com a
// instrução dele saindo só então. Esperas pelo ESTADO, lidas do Node. E o FOCO
// do teclado nos dois botões que saem de cena (R56-5, seção 3).
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'pt-BR' });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  let prazoDoCurto = 300, prazoDoQr = 2;
  await page.route('**/api/**', async (r) => {
    const nome = new URL(r.request().url()).pathname.replace(/^\/api\//, '');
    let c = {};
    try { c = JSON.parse(r.request().postData() || '{}'); } catch (e) { c = {}; }
    let body = { success: true };
    if (nome === 'parear' && c.action === 'create') {
      body = c.comCodigo ? { success: true, code: 'ABC234', curto: true, expiresIn: prazoDoCurto }
        : { success: true, code: 'ABCDEFGHJKLMNPQRSTUV', curto: false, expiresIn: prazoDoQr };
    } else if (nome === 'presenca-app') body = { success: true, online: [], conversas: [] };
    else if (nome === 'buscar-places') body = { success: true, places: [], hasMore: false, page: 1, total: 0 };
    else if (nome === 'perfil') body = { success: true, profile: { id: 1, userName: 'a', rank: 5, isAreaManager: true, isStaff: false, areas: [] } };
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.addInitScript(() => localStorage.setItem('waze_places_preferences',
    JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true })));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await esperarOuExplodir(page, () => typeof AppState !== 'undefined' && typeof showMainScreen === 'function', 'o app');
  await page.evaluate(() => {
    API.setSession('token-de-teste');
    AppState.profile = { id: 1, userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
    showMainScreen(); showLoading(false);
  });
  const tela = () => page.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); return !!e && e.offsetParent !== null && getComputedStyle(e).display !== 'none'; };
    return {
      camera: vis('pairShowBody'), semCamera: vis('pairShowCodeBtn'), digite: vis('pairOrType'),
      qr: document.getElementById('pairExpiry').textContent, curto: document.getElementById('pairCodeExpiry').textContent,
      riscado: document.getElementById('pairCode').classList.contains('line-through'),
      expirado: t('pair.expired'),
    };
  });
  const abrir = async () => {
    await page.click('#helpBtn');
    await esperarOuExplodir(page, () => !document.getElementById('helpModal').classList.contains('hidden'), 'a Ajuda');
    await page.click('#pairCreateBtn');
    await esperarOuExplodir(page, () => /\d:\d\d/.test(document.getElementById('pairExpiry').textContent), 'o QR com a contagem');
  };
  // 1) Sem o código curto.
  await abrir();
  const valendo = await tela();
  checa(valendo.camera && valendo.semCamera, 'pareamento · CONTROLE: com o QR valendo, a instrução da câmera e o "Sem câmera?" aparecem', JSON.stringify(valendo));
  const venceu = await esperarNaPagina(page, () => document.getElementById('pairExpiry').textContent === t('pair.expired'), 8000);
  checa(venceu.ok, 'pareamento: o QR de 2 s não venceu na tela');
  const vencido = await tela();
  checa(!vencido.camera, 'pareamento: QR vencido, e a tela segue mandando apontar a câmera pra ele', JSON.stringify(vencido));
  checa(!vencido.semCamera, 'pareamento: QR vencido, e o "Sem câmera?" segue criando um código novo sob o "Código expirado"', JSON.stringify(vencido));
  await page.click('#pairShowClose');
  // 2) Com o código curto pedido ANTES: nasce depois do QR, então vence depois.
  prazoDoCurto = 4;
  await abrir();
  await page.click('#pairShowCodeBtn');
  await esperarOuExplodir(page, () => /\d:\d\d/.test(document.getElementById('pairCodeExpiry').textContent), 'o código curto');
  // O sinal de que o QR venceu é o "Copiar link" apagando (anterior a este
  // conserto), nunca o que se está medindo: esperar a instrução sumir faria o
  // defeito PENDURAR a espera em vez de reprovar (visto sabotando).
  const qrVenceu = await esperarNaPagina(page, () => document.getElementById('pairCopyLinkBtn').disabled === true, 8000);
  checa(qrVenceu.ok, 'pareamento · CONTROLE: o QR de 2 s não venceu (o "Copiar link" não apagou)');
  const meio = await tela();
  checa(!meio.camera && !meio.semCamera, 'pareamento: QR vencido com o código curto na tela, e a instrução da câmera voltou', JSON.stringify(meio));
  checa(meio.qr === '' && /\d:\d\d/.test(meio.curto) && meio.digite && !meio.riscado,
    'pareamento: QR vencido com o código curto valendo — o "Código expirado" ficou em cima dele, ou a instrução dele sumiu antes da hora',
    JSON.stringify(meio));
  const curtoVenceu = await esperarNaPagina(page, () => document.getElementById('pairCodeExpiry').textContent === t('pair.expired'), 8000);
  checa(curtoVenceu.ok, 'pareamento: o código curto de 4 s não venceu na tela');
  const fim = await tela();
  checa(fim.riscado && !fim.digite, 'pareamento: código curto vencido, e a tela segue mandando digitá-lo', JSON.stringify(fim));
  // 3) O FOCO do teclado (auditoria de 2026-10-01, R56-5). O QR vencendo com o
  // foco no "Copiar link" (que apaga) ou no "Sem câmera?" (que some) largava o
  // foco no <body>, e o Enter no "Sem câmera?" também (ele some quando o código
  // chega): o leitor de tela perdia a posição. O foco vai ao "Fechar" no
  // vencimento e ao "Copiar link" no código. A PRÉ-CONDIÇÃO é o foco no botão
  // antes (sem ela, o "Fechar", foco da abertura, passaria por ele), e o
  // CONTROLE prova que neste motor o botão focado que apaga perde o foco pro
  // <body> — sem isso a medida não enxergaria o defeito.
  const foco = () => page.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.tagName) : ''; });
  await page.click('#pairShowClose');
  prazoDoCurto = 300;
  prazoDoQr = 60;
  await abrir();
  await page.keyboard.press('Shift+Tab');
  checa(await foco() === 'pairCopyLinkBtn', 'pareamento · PRÉ-CONDIÇÃO do controle: o Shift+Tab não pôs o foco no "Copiar link"', await foco());
  await page.evaluate(() => { document.getElementById('pairCopyLinkBtn').disabled = true; });
  await doisQuadros(page);
  const semConserto = await foco();
  checa(semConserto === 'BODY', 'pareamento · CONTROLE: neste motor o botão focado que apaga não perde o foco — a medida não enxerga o defeito', semConserto);
  await page.click('#pairShowClose');
  prazoDoQr = 2;
  for (const [id, voltas] of [['pairCopyLinkBtn', 1], ['pairShowCodeBtn', 2]]) {
    await abrir();
    for (let i = 0; i < voltas; i++) await page.keyboard.press('Shift+Tab');
    const antes = await foco();
    checa(antes === id, `pareamento · PRÉ-CONDIÇÃO: o Shift+Tab não pôs o foco no ${id}`, antes);
    const apagou = await esperarNaPagina(page, () => document.getElementById('pairCopyLinkBtn').disabled === true, 8000);
    checa(apagou.ok, 'pareamento · CONTROLE: o QR de 2 s não venceu (o "Copiar link" não apagou)');
    await doisQuadros(page);
    const depois = await foco();
    checa(depois === 'pairShowClose', `pareamento: o QR venceu com o foco do teclado no ${id}, e o foco foi pro ${depois}`);
    await page.click('#pairShowClose');
  }
  // O Enter no "Sem câmera?" (QR de 60 s: o código chega com ele valendo), e o
  // CONTROLE do clique de mouse, que não move o foco (a regra do C10).
  prazoDoQr = 60;
  for (const pelo of ['teclado', 'mouse']) {
    await abrir();
    if (pelo === 'teclado') {
      await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');
      checa(await foco() === 'pairShowCodeBtn', 'pareamento · PRÉ-CONDIÇÃO: o Shift+Tab não pôs o foco no "Sem câmera?"', await foco());
      await page.keyboard.press('Enter');
    } else await page.click('#pairShowCodeBtn');
    const chegou = await esperarNaPagina(page, () => !document.getElementById('pairCodeReveal').classList.contains('hidden'), 8000);
    checa(chegou.ok, `pareamento · CONTROLE: o código curto não apareceu (${pelo})`);
    await doisQuadros(page);
    const depois = await foco();
    if (pelo === 'teclado') checa(depois === 'pairCopyLinkBtn', `pareamento: o Enter no "Sem câmera?" mostrou o código e o foco foi pro ${depois}`);
    else checa(depois !== 'pairCopyLinkBtn', 'pareamento: o clique de MOUSE no "Sem câmera?" moveu o foco pro "Copiar link"', depois);
    await page.click('#pairShowClose');
  }
  checa(erros.length === 0, 'pareamento: erro de JS', erros[0]);
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
  await presencaViva(ctx);   // a lista da presença sai no showMainScreen (ver o `presencaViva`)
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
  await presencaViva(ctx);   // a lista da presença sai no showMainScreen (ver o `presencaViva`)
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
        // observer do mapa refaz o enquadramento, então a caixa medida no mesmo
        // quadro é a de antes de o card assentar.
        // Medido: 1,29px de sobra "abaixo da dobra" no SE que somem depois —
        // eu ia registrar como defeito do app o que era pressa do instrumento.
        await assentar(page);
        const m = await page.evaluate(() => {
          const c = document.querySelector('.place-card');
          if (!c) return null;
          const val = c.querySelector('.card-flag-reason-value');
          const barra = c.querySelector('.card-btn-reject')?.parentElement;
          const rb = barra ? barra.getBoundingClientRect() : null;
          return {
            motivo: val ? val.textContent : '',
            // O teto de duas linhas (C16, auditoria do card de 2026-09-29): a
            // rede de segurança desligada é o que mantém o arraste pra cima
            // pulando, e as linhas se medem pela CAIXA, não pelo texto.
            rede: c.querySelector('.card-content').classList.contains('card-content-rola'),
            linhas: val ? Math.round(val.getBoundingClientRect().height / parseFloat(getComputedStyle(val).lineHeight)) : 0,
            titulo: val ? val.title : '',
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
        // C16: "Duplicado de «nome longo»" ligava a rede no Fold, e o arraste
        // pra cima passava a rolar em vez de pular.
        checa(!m.rede, `${onde}: o motivo ligou a rede de segurança do card (o arraste pra cima deixa de pular)`);
        checa(m.linhas <= 2, `${onde}: o motivo passou de duas linhas`, `${m.linhas} linhas`);
        if (temNome) checa(m.titulo.includes(DUP_CASOS[nome].duplicado.nome), `${onde}: o nome cortado pelo teto não está inteiro no title`, m.titulo);
        margens[`${aparelho}/${lang}/${nome}`] = m.foraDaDobraCru;
      }
    }
    // CONTROLE do C16: sem o teto, o nome longo LIGA a rede no Fold — é o
    // defeito que o teto conserta. Se não ligar, o instrumento não enxerga a
    // rede, e o "rede desligada" acima não prova nada.
    if (aparelho === 'Galaxy Fold') {
      await page.evaluate(({ pl }) => {
        const s = document.createElement('style');
        s.id = 'sem-teto-do-motivo';
        s.textContent = '.card-flag-reason-value{display:block!important;-webkit-line-clamp:unset!important;overflow:visible!important}';
        document.head.appendChild(s);
        setLang('pt');
        AppState.queue = [pl]; AppState.currentPlace = pl;
        showCurrentPlace();
      }, { pl: DUP_CASOS.nomeLongo });
      await assentar(page);
      const semTeto = await page.evaluate(() => {
        const r = document.querySelector('.place-card .card-content').classList.contains('card-content-rola');
        document.getElementById('sem-teto-do-motivo').remove();
        return r;
      });
      checa(semTeto, 'duplicado Galaxy Fold: CONTROLE — sem o teto, o nome longo não ligou a rede (o instrumento não a enxerga)');
    }
    await ctx.close();
  }
  // CONTROLE: `naoResolvido` é o card de HOJE, sem nada do recurso. Se a margem
  // dele for igual à dos outros, o recurso custou zero pixel de dobra — e se um
  // dia der diferença, a diferença é do recurso, não do app. Sem esta conta eu
  // ia registrar como defeito do app um 1,29px que era o instrumento medindo
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
// A única escrita de dado de LOCAL do app. Três coisas só o browser responde:
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
  // A mesma fachada EM PÉ (9:16): é a proporção que encosta no campo — a de
  // 3:4 fica presa pela largura no Pixel sem teclado e mediria o caso fácil.
  const FOTO_EM_PE = 'data:image/svg+xml;base64,' + Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">'
    + '<rect width="1080" height="1920" fill="#93c5fd"/>'
    + '<rect x="60" y="1120" width="960" height="240" rx="10" fill="#0f766e"/>'
    + '</svg>').toString('base64');
  const PLACE_REN = {
    venueID: 'v-ren', updateRequestID: 'u-ren', name: 'Odontodente Consultório',
    categories: ['DOCTOR_CLINIC'], address: 'Rua das Flores, 250 - Salvador, Bahia',
    updateTypeKey: 'IMAGE', reqType: 'IMAGE', reqSubType: '', createdBy: 'wazer',
    // Fiel ao dado real de um pedido de FOTO NOVA: o tipo, e o id do pedido na
    // URL da foto proposta (aqui no fragmento do data URI, como no bloco do
    // aprovar). O `podeAprovarAtual` exige os dois desde a auditoria de
    // 2026-09-25 — sem eles o botão de aprovar não aparece, e o guard de toque
    // logo abaixo (que EXIGE um botão de ação) reprova.
    purType: 'NEW_PHOTO',
    // Card de FOTO num local que já existe no mapa — que é o caso real: pedido
    // de foto em local aprovado. O bloco do portão logo abaixo varia este campo
    // pros três estados, inclusive o ausente.
    localAprovado: true,
    imageUrls: [FOTO_FACHADA + '#u-ren'], approvedImageIds: [], imageDates: {},
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

    // ── COM A TIRA (2+ fotos) a foto também para antes do CAMPO ─────────────
    // A tira entra no layout e a pílula sobe a altura dela; a foto não subia
    // junto e corria 18px por baixo do campo nos três aparelhos (auditoria de
    // 2026-09-26). O laço de cima mede com UMA foto, onde não há tira.
    const reabrirRen = async (pl) => {
      await page.evaluate(() => { try { fecharEdicaoNome(); } catch {} Lightbox.close(); });
      await page.waitForTimeout(200);   // fechar e abrir no mesmo tique dessincroniza o voltar (gotcha #65)
      await page.evaluate(new Function('a', '(' + montarRen.toString() + ')(a[0],a[1],a[2],a[3])'), [pl, 5, true, false]);
      await assentar(page);
      await page.locator('#lightboxNomeBtn').click();
      await assentar(page);
    };
    await reabrirRen({ ...JSON.parse(JSON.stringify(PLACE_REN)),
      imageUrls: [FOTO_EM_PE + '#u-ren', FOTO_EM_PE + '#aprovada-02'], approvedImageIds: ['aprovada-02'] });
    for (const pct of [0, 0.45]) {
      const kb = Math.round(viewport.height * pct);
      const m = await page.evaluate((px) => {
        document.documentElement.style.setProperty('--kb-inset', px + 'px');
        const r = (el) => el.getBoundingClientRect();
        const lb = document.getElementById('imageLightbox');
        const inp = r(document.getElementById('lightboxNomeInput'));
        const foto = document.getElementById('lightboxImage');
        // A foto RENDERIZADA (object-contain), não a caixa da <img> — ver acima.
        const el = r(foto);
        const escala = Math.min(el.width / foto.naturalWidth, el.height / foto.naturalHeight);
        const base = el.top + (el.height + foto.naturalHeight * escala) / 2;
        return {
          tira: lb.classList.contains('com-tira') && !document.getElementById('lightboxStrip').classList.contains('hidden'),
          editando: lb.classList.contains('editando-nome'), carregou: foto.complete && foto.naturalWidth > 0,
          sobCampo: Math.round(Math.max(0, base - inp.top)), folga: Math.round(inp.top - base),
          _dbg: `foto até ${Math.round(base)} · campo ${Math.round(inp.top)}..${Math.round(inp.bottom)} · livre ${innerHeight - px}`,
        };
      }, kb);
      checa(m.tira && m.editando && m.carregou, `${onde}: PRÉ-CONDIÇÃO — sem a tira, sem a edição ou sem a foto (teclado ${kb}px)`, JSON.stringify(m));
      checa(m.sobCampo === 0, `${onde}: com 2 fotos (tira) e teclado ${kb}px, a foto corre ${m.sobCampo}px por baixo do campo`, m._dbg);
      // CONTROLE: a foto em pé tem que CHEGAR perto do campo (hoje para a 38px
      // dele, como com uma foto só). Longe dele, a medida não mediria nada.
      checa(m.folga <= 60, `${onde}: CONTROLE — a foto em pé parou a ${m.folga}px do campo: a medida está cega`, m._dbg);
    }
    await page.evaluate(() => document.documentElement.style.setProperty('--kb-inset', '0px'));
    await reabrirRen(JSON.parse(JSON.stringify(PLACE_REN)));   // o resto do bloco é com uma foto

    // ── ENVIO: medido pela REDE, não pelo DOM ───────────────────────────────
    // E o que o leitor de tela recebe (R6-3-09, auditoria de 2026-10-01): o
    // nome acessível da pílula leva o nome que ela MOSTRA, e o texto
    // alternativo da foto passa ao nome novo junto com a pílula — seguia com o
    // antigo até trocar de foto. CONTROLE: o ✕ achado pelo nome na árvore de
    // acessibilidade (a medida enxerga a camada).
    const pilulaPeloNome = (nome) => page.getByRole('button', { name: `Corrigir o nome do local: ${nome}`, exact: true }).count();
    await page.evaluate(() => { try { fecharEdicaoNome(); } catch {} });
    checa(await page.getByRole('button', { name: 'Fechar', exact: true }).count() >= 1,
      `${onde}: CONTROLE — o ✕ não é achado pelo nome acessível (a medida estaria cega)`);
    checa(await pilulaPeloNome('Odontodente Consultório') === 1,
      `${onde}: a pílula não diz, no nome acessível, o nome do local que mostra`,
      await page.locator('#lightboxNomeBtn').ariaSnapshot().catch(() => ''));
    await page.locator('#lightboxNomeBtn').click();
    await assentar(page);
    await page.locator('#lightboxNomeInput').fill('Odontodente Sorriso');
    posts.length = 0;
    await page.locator('#lightboxNomeOk').click();
    await page.waitForTimeout(400);
    checa(posts.length === 0, `${onde}: gravou ANTES de a janela do Desfazer vencer`);
    const altRen = await page.evaluate(() => document.getElementById('lightboxImage').alt);
    checa(altRen.includes('Odontodente Sorriso'), `${onde}: renomeado, o texto alternativo da foto seguiu com o nome antigo`, altRen);
    checa(await pilulaPeloNome('Odontodente Sorriso') === 1, `${onde}: renomeado, a pílula segue anunciada com o nome antigo`,
      await page.locator('#lightboxNomeBtn').ariaSnapshot().catch(() => ''));
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

// ── Renomeando: o passo pra TRÁS só sai da edição (auditoria de 2026-09-26) ──
//
// Tocar no fundo (o reflexo de "baixar o teclado"), arrastar a foto pra baixo,
// e Esc ou ↓ com o foco no ✓/✕ da edição FECHAVAM o lightbox: o nome digitado
// e a foto que servia de prova iam embora juntos. Só o Esc do CAMPO tratava
// isso. Mouse e teclado de verdade (valem nos dois motores). O CONTROLE são os
// mesmos gestos SEM edição, que têm que fechar — sem ele, "a foto ficou aberta"
// passaria também com o gesto que não chega a lugar nenhum.
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 80)));
  const posts = [];
  await page.route('**/api/**', async (route) => {
    const r = route.request();
    if (r.method() === 'POST' && /renomear-local/.test(r.url())) posts.push(r.url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  const FACHADA = 'data:image/svg+xml;base64,' + Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1600"><rect width="900" height="1600" fill="#93c5fd"/></svg>').toString('base64');
  const PL = {
    venueID: 'v-l4', updateRequestID: 'u-l4', name: 'Padaria Pão Quente', categories: ['BAKERY'], address: 'Rua X, 1',
    updateTypeKey: 'IMAGE', reqType: 'IMAGE', purType: 'NEW_PHOTO', createdBy: 'wazer', localAprovado: true,
    imageUrls: [FACHADA + '#u-l4'], approvedImageIds: [], lat: -12.9, lon: -38.3, mapa: null, changes: [],
  };
  const abrir = async (editar) => {
    // Fechar e reabrir no MESMO tique é o gotcha #65 no instrumento: o
    // `history.back()` que o fechamento agenda come a entrada que a abertura
    // empilha, e o fechamento seguinte sai da PÁGINA (medido: "Execution
    // context was destroyed"). Fecha, espera, e só então abre.
    await page.evaluate(() => { if (Lightbox.isOpen()) Lightbox.close(); });
    await page.waitForTimeout(150);
    await page.evaluate((pl) => {
      setLang('pt'); applyI18n();
      API.setSession('tok-smoke');
      AppState.authenticated = true;
      AppState.profile = { id: 1, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false };
      document.getElementById('authScreen').classList.add('hidden');
      document.getElementById('appScreen').classList.remove('hidden');
      document.getElementById('noMoreCards').classList.add('hidden');
      showLoading(false);
      const p = JSON.parse(JSON.stringify(pl));
      AppState.queue = [p]; AppState.currentPlace = p;
      document.querySelectorAll('.place-card').forEach((e) => e.remove());
      showCurrentPlace();
      Lightbox.open(p.imageUrls, 0, 0, p.name, false, p);
    }, PL);
    await assentar(page);
    if (editar) {
      await page.click('#lightboxNomeBtn');
      await page.fill('#lightboxNomeInput', 'Padaria Pão Quentinho do Zé');
    }
    return page.evaluate(() => ({ aberto: Lightbox.isOpen(),
      editando: document.getElementById('lightboxNome').classList.contains('editando') }));
  };
  const agora = () => page.evaluate(() => ({ aberto: Lightbox.isOpen(),
    editando: document.getElementById('lightboxNome').classList.contains('editando') }));
  // Um ponto do FUNDO (o próprio #imageLightbox) que recebe o dedo — onde a
  // foto não cobre: a faixa de cima (o `padding-top` da edição) ou as tarjas.
  const pontoDoFundo = () => page.evaluate(() => {
    for (let y = 2; y < innerHeight; y += 6) for (let x = 4; x < innerWidth; x += 8) {
      const q = document.elementFromPoint(x, y);
      if (q && q.id === 'imageLightbox') return { x, y };
    }
    return null;
  });
  const PASSOS = [
    ['toque no fundo', async () => { const p = await pontoDoFundo(); if (!p) return false; await page.mouse.click(p.x, p.y); return true; }],
    ['arrastar a foto pra baixo', async () => {
      const r = await page.evaluate(() => document.getElementById('lightboxImage').getBoundingClientRect().toJSON());
      const x = r.left + r.width / 2, y = r.top + 40;
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x, y + 160, { steps: 8 }); await page.mouse.up();
      return true;
    }],
    ['Esc com o foco no ✓', async () => { await page.focus('#lightboxNomeOk'); await page.keyboard.press('Escape'); return true; }],
    ['↓ com o foco no ✕', async () => { await page.focus('#lightboxNomeCancel'); await page.keyboard.press('ArrowDown'); return true; }],
  ];
  for (const [nome, passo] of PASSOS) {
    const antes = await abrir(true);
    checa(antes.aberto && antes.editando, `passo pra trás/${nome}: PRÉ-CONDIÇÃO — não entrou em edição`, JSON.stringify(antes));
    const deu = await passo();
    checa(deu, `passo pra trás/${nome}: não achei onde fazer o gesto`);
    await page.waitForTimeout(250);
    const d = await agora();
    checa(d.aberto, `passo pra trás/${nome}: editando o nome, FECHOU a foto — o nome digitado e a prova foram embora`);
    checa(!d.editando, `passo pra trás/${nome}: não saiu da edição`);
  }
  // CONTROLE: os mesmos gestos sem edição fecham a foto (menos Esc/↓ no ✓/✕,
  // que só existem editando — no lugar deles vai o Esc/↓ com o foco no ✕ do
  // lightbox).
  for (const [nome, passo] of [
    ['toque no fundo', PASSOS[0][1]], ['arrastar a foto pra baixo', PASSOS[1][1]],
    ['Esc', async () => { await page.focus('#lightboxClose'); await page.keyboard.press('Escape'); return true; }],
    ['↓', async () => { await page.focus('#lightboxClose'); await page.keyboard.press('ArrowDown'); return true; }],
  ]) {
    const antes = await abrir(false);
    checa(antes.aberto && !antes.editando, `CONTROLE passo pra trás/${nome}: PRÉ-CONDIÇÃO`, JSON.stringify(antes));
    await passo();
    await page.waitForTimeout(250);
    checa(!(await agora()).aberto, `CONTROLE passo pra trás/${nome}: sem edição o gesto não fechou a foto — a medida está cega`);
  }
  checa(posts.length === 0, `passo pra trás: ${posts.length} renomeação(ões) saíram de uma edição DESISTIDA`);
  checa(erros.length === 0, 'passo pra trás: erro de JS', erros[0]);
  await ctx.close();
}

// ── O FOCO não cai no <body> nas camadas de ampliar (auditoria de 2026-09-26) ─
//
// Fechar a foto ou o mapa (Esc, ✕, ↓) e sair da edição do nome com a foto
// aberta jogavam o foco no <body>: quem usa teclado ou leitor de tela
// recomeçava do topo da página (e, com a foto aberta, fora da camada
// `aria-modal`). O CONTROLE é o Filtros, que sempre devolveu o foco ao botão
// que o abriu: sem ele, "o foco não está no <body>" passaria também com a
// medida lendo o elemento errado. E o ✨ e a miniatura da proposta passaram a
// ter NOME pro leitor de tela (antes: o emoji, e "Ver foto 2 de 3" em todas).
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  await ctx.route('**/*-tiles/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_CINZA }));
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 80)));
  // Cada rota com a FORMA que o app espera: abrir o Filtros (o controle) pede
  // países, e uma resposta genérica ali vira erro de JS na página.
  // `segurar(nome)`: a PRÓXIMA resposta dessa rota espera o roteiro soltá-la
  // (`solta(corpo)`, com o corpo que ela devolve) — a busca da página seguinte
  // no ar e a exclusão no ar com a foto já fechada (R9-3-02, R9-3-04/05).
  const seguras = {};
  const segurar = (nome) => {
    let solta;
    seguras[nome] = new Promise((ok) => { solta = ok; });
    return (corpo) => { delete seguras[nome]; solta(corpo); };
  };
  await page.route('**/api/**', async (route) => {
    const nome = route.request().url().split('/api/')[1].split('?')[0];
    // O aquecimento da lixeira (`action: 'preparar'`, que sai no toque COM o Desfazer)
    // divide a rota com a exclusão, e desde o lote 16 (R12-3-01) a exclusão do local
    // ESPERA a resposta dele (a vez das escritas de foto): segurá-lo junto seria segurar
    // a exclusão antes de ela sair. O que um `segurar('excluir-foto')` segura é a EXCLUSÃO.
    let acao = null;
    try { acao = JSON.parse(route.request().postData() || '{}').action; } catch { acao = null; }
    const segura = acao === 'preparar' ? null : seguras[nome];
    const corpo = (segura && await segura) || (nome === 'lista-paises' ? { success: true, countries: [] }
      : nome === 'lista-estados' ? { success: true, states: [] }
        : nome === 'perfil' ? { success: true, profile: { id: 1, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false } }
          : { success: true, places: [], hasMore: false, total: 0 });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });
  });
  await presencaViva(page);   // registrada DEPOIS: a última rota que casa é a que responde
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  const FOTO_PL = {
    venueID: 'v-foco', updateRequestID: 'pend-01', name: 'Padaria Pão Quente', categories: ['BAKERY'],
    address: 'Rua X, 1', updateTypeKey: 'IMAGE', reqType: 'IMAGE', purType: 'NEW_PHOTO', createdBy: 'wazer',
    localAprovado: true, lat: -12.9, lon: -38.3, mapa: null, changes: [],
    imageUrls: [`${foto}#pend-01`, `${foto}#aprovada-02`], approvedImageIds: ['aprovada-02'],
  };
  const MAPA_PL = { ...FOTO_PL, venueID: 'v-foco-mapa', updateRequestID: 'u-mapa', updateTypeKey: 'UPDATE',
    reqType: 'REQUEST', purType: 'DETAILS_UPDATE', imageUrls: [], approvedImageIds: [],
    mapa: { centro: [-12.9, -38.3], proposto: null, movidoM: null, entradas: [] } };
  // `depois`: os pedidos que vêm DEPOIS deste na fila, e ela termina neles (sem
  // mais o que buscar: o fim da fila é o painel "Tudo limpo!", na hora). `mais`:
  // o Waze diz que há mais (a fila acaba e a página seguinte SAI, R9-3-02).
  const montar = async (pl, { semDesfazer = false, depois = null, mais = false } = {}) => {
    await page.evaluate(() => { if (Lightbox.isOpen()) Lightbox.close(); if (MapaLightbox.isOpen()) MapaLightbox.close(); });
    await page.waitForTimeout(150);   // fechar e abrir no mesmo tique é o gotcha #65
    await page.evaluate(({ p0, semDesfazer: sem, depois: resto, mais: haMais }) => {
      setLang('pt'); applyI18n();
      // As partes repetem os MESMOS ids de foto na mesma página, e a foto que uma
      // exclusão já tirou do mapa não vai ao Waze de novo (`fotosQueSairamDoMapa`,
      // R12-3-02, lote 16): sem zerar, a 2ª parte nunca tinha exclusão no ar.
      if (typeof fotosQueSairamDoMapa !== 'undefined') fotosQueSairamDoMapa.clear();
      API.setSession('tok-smoke');
      AppState.authenticated = true;
      AppState.profile = { id: 1, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false };
      AppState.preferences.undoGateSeen = true;
      // Sem Desfazer a ação sai na hora: o `canDisableUndo()` exige a cota, e o
      // modo dev a dispensa (a mesma montagem do bloco da fila de saída).
      AppState.preferences.undoEnabled = !sem;
      AppState.devMode = { unlocked: sem, active: sem };
      document.getElementById('authScreen').classList.add('hidden');
      document.getElementById('appScreen').classList.remove('hidden');
      document.getElementById('noMoreCards').classList.add('hidden');
      document.getElementById('filtersBtn').classList.remove('hidden');
      showLoading(false);
      const p = JSON.parse(JSON.stringify(p0));
      AppState.queue = [p]; AppState.currentPlace = p;
      if (resto) {
        AppState.queue.push(...JSON.parse(JSON.stringify(resto)));
        AppState.hasMore = false; AppState.serverTotal = AppState.queue.length;
      }
      if (haMais) AppState.hasMore = true;
      document.querySelectorAll('.place-card').forEach((e) => e.remove());
      showCurrentPlace();
    }, { p0: pl, semDesfazer, depois, mais });
    await assentar(page);
  };
  // Onde está o foco, e se ele está NO LUGAR CERTO: o id, a classe do card, e
  // se o elemento está na tela (um foco num elemento escondido é foco perdido).
  const foco = () => page.evaluate(() => {
    const a = document.activeElement;
    const card = document.querySelector('#cardStack .place-card:not(.card-fundo)');
    return { id: a && a.id, body: a === document.body, visivel: !!(a && a.getClientRects().length),
      fotoDoCard: !!(card && a === card.querySelector('.card-image')),
      mapaDoCard: !!(card && a === card.querySelector('.card-map')),
      naFoto: !!(a && a.closest && a.closest('#imageLightbox')) };
  });
  // CONTROLE: o Filtros, pelo teclado, devolve o foco ao botão que o abriu.
  await montar(FOTO_PL);
  await page.focus('#filtersBtn'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  const f0 = await foco();
  checa(f0.id === 'filtersBtn', 'foco: CONTROLE — o Filtros não devolveu o foco ao botão (a medida estaria cega)', JSON.stringify(f0));

  // A foto: aberta pelo toque na foto do card, fechada por Esc, ↓ e ✕.
  for (const [nome, fechar] of [
    ['Esc', () => page.keyboard.press('Escape')],
    ['↓', () => page.keyboard.press('ArrowDown')],
    ['✕', () => page.click('#lightboxClose')],
  ]) {
    await montar(FOTO_PL);
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await page.waitForTimeout(350);
    checa(await page.evaluate(() => Lightbox.isOpen()), `foco/foto ${nome}: PRÉ-CONDIÇÃO — a foto não abriu`);
    await fechar(); await page.waitForTimeout(300);
    const f = await foco();
    checa(!f.body && f.visivel && f.fotoDoCard,
      `foco/foto: fechar pelo ${nome} não devolveu o foco à foto do card`, JSON.stringify(f));
  }
  // O mapa: aberto pelo toque no mapa do card, fechado por Esc e ✕.
  for (const [nome, fechar] of [['Esc', () => page.keyboard.press('Escape')], ['✕', () => page.click('#mapaLbClose')]]) {
    await montar(MAPA_PL);
    await page.click('#cardStack .place-card:not(.card-fundo) .card-map');
    await page.waitForTimeout(400);
    checa(await page.evaluate(() => MapaLightbox.isOpen()), `foco/mapa ${nome}: PRÉ-CONDIÇÃO — o mapa não abriu`);
    await fechar(); await page.waitForTimeout(300);
    const f = await foco();
    checa(!f.body && f.visivel && f.mapaDoCard,
      `foco/mapa: fechar pelo ${nome} não devolveu o foco ao mapa do card`, JSON.stringify(f));
  }
  // Sair da edição do nome, pelo teclado: o foco volta pra PÍLULA.
  for (const [nome, sair] of [
    ['Esc no campo', () => page.keyboard.press('Escape')],
    ['✕ da edição (Enter)', async () => { await page.focus('#lightboxNomeCancel'); await page.keyboard.press('Enter'); }],
  ]) {
    await montar(FOTO_PL);
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await page.waitForTimeout(350);
    await page.focus('#lightboxNomeBtn'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    const e0 = await foco();
    checa(e0.id === 'lightboxNomeInput', `foco/edição ${nome}: PRÉ-CONDIÇÃO — a edição não abriu com o foco no campo`, JSON.stringify(e0));
    await sair(); await page.waitForTimeout(200);
    const f = await foco();
    checa(f.id === 'lightboxNomeBtn', `foco/edição: sair pelo ${nome} não devolveu o foco à pílula do nome`, JSON.stringify(f));
  }
  // Aprovar e salvar o nome pelo teclado: o botão com o foco some ou trava, e o
  // foco fica NA camada (a pílula trava na janela: vai pro ✕).
  for (const [nome, agir, semDesfazer] of [
    ['aprovar', async () => { await page.focus('#lightboxApprove'); await page.keyboard.press('Enter'); }, false],
    // SEM Desfazer não há banner (é ele que, sumindo, também devolve o foco): o
    // "Aprovar" vira spinner `disabled`, e é a ação que mantém o foco na camada.
    ['aprovar sem Desfazer', async () => { await page.focus('#lightboxApprove'); await page.keyboard.press('Enter'); }, true],
    ['salvar o nome', async () => {
      await page.focus('#lightboxNomeBtn'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
      await page.keyboard.type(' do Zé'); await page.keyboard.press('Enter');
    }, false],
  ]) {
    await montar(FOTO_PL, { semDesfazer });
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await page.waitForTimeout(350);
    await agir(); await page.waitForTimeout(250);
    const f = await foco();
    checa(!f.body && f.visivel && f.naFoto, `foco/${nome}: o foco saiu da foto aberta`, JSON.stringify(f));
    // desfaz, pra nada sair pela rede e o bloco seguinte começar limpo
    await page.evaluate(() => { const u = document.getElementById('undoBtn'); if (u) u.click(); });
    await page.waitForTimeout(150);
  }
  // A TRAVA que desabilita a ação FOCADA (R7-3-06, auditoria de 2026-10-02): a
  // conferência de um 401 (a mesma trava da queda da sessão e do lote) escreve
  // `disabled` no "Aprovar" e na pílula, o botão focado perde o foco — o
  // NAVEGADOR o tira — e ele caía no <body> com a camada `aria-modal` aberta. Ele
  // fica na camada (no ✕: a pílula trava junto), também quando a trava acaba.
  // CONTROLE: o foco no ✕ (que não trava) não é mexido.
  for (const alvo of ['#lightboxApprove', '#lightboxNomeBtn', '#lightboxClose']) {
    await montar(FOTO_PL);
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await page.waitForTimeout(350);
    await page.focus(alvo);
    const t0 = await foco();
    checa('#' + t0.id === alvo, `foco/trava ${alvo}: PRÉ-CONDIÇÃO — o foco não pousou`, JSON.stringify(t0));
    await page.evaluate(() => { escritasConferindo++; aplicarTravaDeAcao(); });
    await doisQuadros(page);
    const t1 = await foco();
    const travou = await page.evaluate((a) => document.querySelector(a).disabled, alvo);
    if (alvo === '#lightboxClose') {
      checa(t1.id === 'lightboxClose', 'foco/trava: CONTROLE — a trava tirou o foco do ✕', JSON.stringify(t1));
    } else {
      checa(travou, `foco/trava ${alvo}: PRÉ-CONDIÇÃO — a trava não desabilitou a ação`);
      checa(!t1.body && t1.visivel && t1.naFoto, `foco/trava: a trava desabilitou ${alvo} com o foco nele e o foco caiu fora da foto aberta`, JSON.stringify(t1));
    }
    await page.evaluate(() => { escritasConferindo--; aplicarTravaDeAcao(); });
    await doisQuadros(page);
    const t2 = await foco();
    checa(!t2.body && t2.naFoto, `foco/trava ${alvo}: a trava acabou e o foco saiu da foto aberta`, JSON.stringify(t2));
  }
  // O ✨ e a miniatura da proposta com NOME pro leitor de tela.
  await montar(FOTO_PL);
  await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
  await page.waitForTimeout(350);
  const nomes = await page.evaluate(() => {
    const b = document.getElementById('lightboxNewBadge');
    const minis = [...document.querySelectorAll('#lightboxStrip .lb-mini')].map((m) => m.getAttribute('aria-label'));
    return { visivel: !b.classList.contains('hidden'), role: b.getAttribute('role'), nome: b.getAttribute('aria-label'),
      titulo: b.title, minis, newIdx: Lightbox.newIdx };
  });
  checa(nomes.visivel && nomes.role === 'img' && !!nomes.nome && nomes.nome === nomes.titulo,
    'foco: o ✨ chega ao leitor de tela sem nome (só o emoji)', JSON.stringify(nomes));
  checa(nomes.minis.length === 2 && nomes.minis[nomes.newIdx].includes(nomes.nome)
    && nomes.minis.filter((m) => m.includes(nomes.nome)).length === 1,
    'foco: a miniatura da proposta não diz que é a proposta (ou todas dizem)', JSON.stringify(nomes.minis));
  // A troca de foto pelo TECLADO com o foco NA AÇÃO (auditoria de 2026-10-01).
  // R6-3-06: o foco no "Aprovar" e a → (a foto já no mapa): a ação é da OUTRA
  // foto, some, e o foco caía no <body> com a camada `aria-modal` aberta.
  // R6-3-08: a troca não era dita a ninguém — a região viva da camada diz a
  // posição e o selo. R6-3-09: a pílula era anunciada só como "Corrigir o nome
  // do local", sem o nome que mostra. CONTROLES: o ✕ achado pelo NOME na árvore
  // de acessibilidade (a medida enxerga a camada) e o foco no ✕, que a troca
  // não pode mexer.
  {
    await page.focus('#lightboxApprove');
    const a0 = await foco();
    checa(a0.id === 'lightboxApprove', 'foco/troca: PRÉ-CONDIÇÃO — o foco não está no "Aprovar" da proposta', JSON.stringify(a0));
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250);
    const a1 = await foco();
    const anuncio = () => page.evaluate(() => document.getElementById('lightboxAnuncio')?.textContent ?? '(sem região)');
    const an1 = await anuncio();
    checa(!a1.body && a1.visivel && a1.naFoto, 'foco/troca: a → com o foco no "Aprovar" largou o foco fora da foto aberta', JSON.stringify(a1));
    checa(an1 === 'Foto 2 de 2', 'foco/troca: a → trocou a foto e a região viva não disse qual', JSON.stringify(an1));
    await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(250);
    const an2 = await anuncio();
    checa(an2 === `Foto 1 de 2 — ${nomes.nome}`, 'foco/troca: de volta à proposta, a região viva não disse que é ela', JSON.stringify(an2));
    await page.focus('#lightboxClose');
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250);
    const a3 = await foco();
    checa(a3.id === 'lightboxClose', 'foco/troca: CONTROLE — a troca de foto tirou o foco do ✕', JSON.stringify(a3));
    const pelo = (nome) => page.getByRole('button', { name: nome, exact: true }).count();
    checa(await pelo('Fechar') >= 1, 'foco/pílula: CONTROLE — o ✕ não é achado pelo nome acessível (a medida estaria cega)');
    checa(await pelo('Corrigir o nome do local: Padaria Pão Quente') === 1,
      'foco/pílula: o nome acessível da pílula não diz o nome do local que ela mostra',
      await page.locator('#lightboxNomeBtn').ariaSnapshot().catch(() => ''));
  }
  // Na DENÚNCIA o selo é 🚩 e o nome muda junto — o do HTML é o do ✨.
  await montar({ ...FOTO_PL, venueID: 'v-foco-flag', updateRequestID: 'u-flag', updateTypeKey: 'FLAG',
    reqType: 'REQUEST', reqSubType: 'FLAG', purType: 'FLAGGED_PHOTO', flagSubjectType: 'IMAGE',
    flagEntityID: 'denunciada-01', imageUrls: [`${foto}#denunciada-01`, `${foto}#aprovada-02`],
    approvedImageIds: ['denunciada-01', 'aprovada-02'] });
  await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
  await page.waitForTimeout(350);
  const flag = await page.evaluate(() => {
    const b = document.getElementById('lightboxNewBadge');
    return { txt: b.textContent, nome: b.getAttribute('aria-label'), titulo: b.title,
      mini: document.querySelector('#lightboxStrip .lb-mini').getAttribute('aria-label') };
  });
  checa(flag.txt === '🚩' && flag.nome === flag.titulo && flag.nome !== nomes.nome && flag.mini.includes(flag.nome),
    'foco: na denúncia o 🚩 segue com o NOME do ✨ (ou a miniatura não diz qual é a denunciada)', JSON.stringify(flag));

  // ── R8-3-04 (auditoria de 2026-10-03): corrigindo o nome, a trava que acende
  // com o foco no ✓ "Salvar nome" (o Tab a partir do campo) o desabilita, e o
  // foco ia pro ✕ que FECHA A FOTO (a pílula é rótulo na edição): o Enter
  // seguinte fechava a foto e jogava fora o nome digitado. O foco vai ao CAMPO,
  // e o Enter ali diz o que esperar com a edição aberta e o nome intacto.
  // CONTROLE: o foco que JÁ estava no campo fica nele (o R7-3-06, acima, mede
  // as ações fora da edição, que vão pro ✕).
  for (const [onde, alvo] of [['✓', 'lightboxNomeOk'], ['campo', 'lightboxNomeInput']]) {
    await montar(FOTO_PL);
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await page.waitForTimeout(350);
    await page.focus('#lightboxNomeBtn'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    await page.keyboard.type(' do Zé');
    if (onde === '✓') await page.keyboard.press('Tab');
    const e0 = await foco();
    checa(e0.id === alvo, `foco/edição+trava ${onde}: PRÉ-CONDIÇÃO — o foco não pousou no ${alvo}`, JSON.stringify(e0));
    await page.evaluate(() => { escritasConferindo++; aplicarTravaDeAcao(); });
    await doisQuadros(page);
    const okTravado = await page.evaluate(() => document.getElementById('lightboxNomeOk').disabled);
    const e1 = await foco();
    checa(okTravado, `foco/edição+trava ${onde}: PRÉ-CONDIÇÃO — a trava não desabilitou o ✓`);
    checa(e1.id === 'lightboxNomeInput',
      `foco/edição+trava: com o foco no ${onde}, a trava o levou a ${e1.body ? '<body>' : e1.id} — não ao CAMPO do nome`, JSON.stringify(e1));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const e2 = await page.evaluate(() => ({ aberta: Lightbox.isOpen(), editando: editandoNome(),
      campo: document.getElementById('lightboxNomeInput').value }));
    checa(e2.aberta && e2.editando && /do Zé$/.test(e2.campo),
      `foco/edição+trava ${onde}: o Enter na trava fechou a foto ou jogou fora o nome digitado`, JSON.stringify(e2));
    await page.evaluate(() => { escritasConferindo--; aplicarTravaDeAcao(); });
    await doisQuadros(page);
    await page.keyboard.press('Escape');               // sai da edição (o Esc do campo)
    await page.waitForTimeout(150);
  }

  // Um pedido de FOTO NOVA com UMA foto só (a proposta), pra aprovar e excluir.
  const soAProposta = (n, nomeDele) => ({ ...FOTO_PL, venueID: 'v-r8-' + n, updateRequestID: 'pend-r8-' + n,
    name: nomeDele, imageUrls: [`${foto}#pend-r8-${n}`], approvedImageIds: [] });
  const aprovarPeloTeclado = async () => {
    await esperarOuExplodir(page, () => Lightbox.isOpen() && fotoDoLightboxNaTela()
      && !document.getElementById('lightboxApprove').classList.contains('hidden'), 'o "Aprovar" da foto proposta');
    await page.focus('#lightboxApprove'); await page.keyboard.press('Enter');
    await esperarOuExplodir(page, () => placeResolvidoPorAprovacao !== null && !aprovandoAgora, 'a aprovação pousar');
  };

  // ── R8-3-06 (auditoria de 2026-10-03): aprovar a foto do ÚLTIMO pedido e
  // fechar a foto pelo teclado — a aprovação pousada anda a fila ao fechar, a
  // fila acaba no "Tudo limpo!" e o foco ia pro ⓘ da Ajuda, no topo da página.
  // Ele vai ao "Verificar novamente", como no Enter no ✓ do último card
  // (R7-2-06). CONTROLE: com um pedido depois, o foco vai à foto do card novo.
  for (const ultimo of [true, false]) {
    await montar(soAProposta(1, 'Padaria Um'), { semDesfazer: true, depois: ultimo ? [] : [soAProposta(2, 'Padaria Dois')] });
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await aprovarPeloTeclado();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const f = await foco();
    const fim = await page.evaluate(() => ({ painel: !document.getElementById('noMoreCards').classList.contains('hidden'),
      frente: AppState.currentPlace && AppState.currentPlace.updateRequestID }));
    if (ultimo) {
      checa(fim.painel, 'foco/último aprovado: PRÉ-CONDIÇÃO — a fila não acabou no "Tudo limpo!" ao fechar a foto', JSON.stringify(fim));
      checa(f.id === 'reloadBtn',
        `foco/último aprovado: fechar a foto com a fila no fim levou o foco a ${f.body ? '<body>' : f.id}, não ao "Verificar novamente"`, JSON.stringify(f));
    } else {
      checa(fim.frente === 'pend-r8-2' && f.fotoDoCard,
        'foco/último aprovado: CONTROLE — com outro pedido depois, o foco não foi à foto do card novo', JSON.stringify({ f, fim }));
    }
  }

  // ── R8-3-07 (auditoria de 2026-10-03): aprovar a foto proposta e excluí-la
  // sem o Desfazer (a lixeira é o caminho de volta da aprovação), num local em
  // que ela é a ÚNICA foto: a exclusão fecha a camada, o fechamento anda a fila,
  // e "Foto excluída" sobrescrevia, na MESMA tarefa, o anúncio do card novo (ou
  // o "Tudo limpo!") — o leitor de tela só ouvia "Foto excluída". Mede-se o
  // texto FINAL da região do card, que é o que ele ouve. CONTROLES: aprovar e só
  // fechar diz o card novo, sem "Foto excluída"; e excluir a última foto de um
  // local que NÃO anda a fila (a foto já no mapa) diz só "Foto excluída" (R7-3-04).
  const regiaoDoCard = () => page.evaluate(() => document.getElementById('cardLiveRegion').textContent);
  for (const [nome, depois, excluir, espera] of [
    ['com outro pedido depois', [soAProposta(4, 'Padaria Quatro')], true,
      (s) => s.startsWith('Foto excluída. ') && s.includes('Padaria Quatro')],
    ['no último pedido', [], true, (s) => s.startsWith('Foto excluída. ') && s.includes('Tudo limpo')],
    ['CONTROLE — aprovar e só fechar', [soAProposta(4, 'Padaria Quatro')], false,
      (s) => !s.includes('Foto excluída') && s.includes('Padaria Quatro')],
  ]) {
    await montar(soAProposta(3, 'Padaria Três'), { semDesfazer: true, depois });
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await aprovarPeloTeclado();
    if (excluir) {
      await esperarOuExplodir(page, () => !document.getElementById('lightboxDelete').classList.contains('hidden')
        && !document.getElementById('lightboxDelete').disabled, 'a lixeira na foto recém-aprovada');
      await page.click('#lightboxDelete');
      await esperarOuExplodir(page, () => !excluindoAgora && !Lightbox.isOpen(), 'a exclusão fechar a foto ampliada');
    } else {
      await page.click('#lightboxClose');
    }
    await page.waitForTimeout(300);
    const s = await regiaoDoCard();
    checa(espera(s), `anúncio/${nome}: a região do card terminou dizendo ${JSON.stringify(s)}`);
  }
  {
    // CONTROLE (R7-3-04): a foto já no mapa, a única do local, excluída sem o
    // Desfazer — a camada fecha e o MESMO card é redesenhado: só "Foto excluída".
    const noMapa = { ...soAProposta(5, 'Padaria Cinco'), imageUrls: [`${foto}#aprovada-r8-5`], approvedImageIds: ['aprovada-r8-5'] };
    await montar(noMapa, { semDesfazer: true, depois: [soAProposta(6, 'Padaria Seis')] });
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await esperarOuExplodir(page, () => Lightbox.isOpen() && fotoDoLightboxNaTela()
      && !document.getElementById('lightboxDelete').classList.contains('hidden'), 'a lixeira da foto no mapa');
    await page.click('#lightboxDelete');
    await esperarOuExplodir(page, () => !excluindoAgora && !Lightbox.isOpen(), 'a exclusão fechar a foto ampliada');
    await page.waitForTimeout(300);
    const s = await regiaoDoCard();
    const frente = await page.evaluate(() => AppState.currentPlace && AppState.currentPlace.updateRequestID);
    checa(frente === 'pend-r8-5' && s === 'Foto excluída',
      `anúncio/CONTROLE (R7-3-04): sem trocar o card, a região do card terminou dizendo ${JSON.stringify(s)}`, frente);
  }

  // ── R9-3-02 (auditoria de 2026-10-06): a fila acaba com a página seguinte NO
  // AR. Aprovar a foto do ÚLTIMO pedido e fechar pelo Esc com a busca ainda
  // correndo: sem card e sem painel (o esqueleto), o fechar levava o foco ao ⓘ do
  // topo e ele FICAVA lá quando o "Tudo limpo!" (D1) ou o card novo (D2)
  // chegavam. Ele fica prometido e pousa no "Verificar novamente" ou na foto do
  // card que chegou. PRÉ-CONDIÇÃO medida: a busca no ar, sem card e sem painel,
  // no instante do Esc (sem ela, o caso é o R8-3-06, acima).
  for (const [nome, traz] of [['D1, a busca volta vazia', null], ['D2, a busca traz um pedido', soAProposta(19, 'Padaria Dezenove')]]) {
    await montar(soAProposta(18, 'Padaria Dezoito'), { semDesfazer: true, depois: [], mais: true });
    const solta = segurar('buscar-places');
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await aprovarPeloTeclado();
    await page.keyboard.press('Escape');
    await esperarOuExplodir(page, () => !Lightbox.isOpen() && AppState.fetching, 'a foto fechar com a busca da página seguinte no ar');
    await doisQuadros(page);
    const meio = await page.evaluate(() => ({ fetching: AppState.fetching, card: !!cardDaFrente(),
      painel: !document.getElementById('noMoreCards').classList.contains('hidden'),
      foco: document.activeElement && (document.activeElement.id || document.activeElement.tagName) }));
    checa(meio.fetching && !meio.card && !meio.painel,
      `foco/busca no ar ${nome}: PRÉ-CONDIÇÃO — no fechamento a busca não estava no ar sem card e sem painel`, JSON.stringify(meio));
    checa(meio.foco !== 'helpBtn', `foco/busca no ar ${nome}: o fechar da foto levou o foco ao ⓘ do topo`, JSON.stringify(meio));
    solta({ success: true, places: traz ? [traz] : [], hasMore: false, page: 1, total: traz ? 1 : 0, totalAll: traz ? 1 : 0, blocked: 0 });
    await esperarOuExplodir(page, () => !AppState.fetching
      && (!!cardDaFrente() || !document.getElementById('noMoreCards').classList.contains('hidden')), 'o painel ou o card depois da busca');
    await doisQuadros(page);
    const f = await foco();
    if (traz) {
      checa(f.fotoDoCard, `foco/busca no ar ${nome}: o card novo chegou e o foco ficou em ${f.body ? '<body>' : f.id} — não na foto dele`, JSON.stringify(f));
    } else {
      checa(f.id === 'reloadBtn', `foco/busca no ar ${nome}: o "Tudo limpo!" chegou e o foco ficou em ${f.body ? '<body>' : f.id}`, JSON.stringify(f));
    }
  }

  // ── R9-3-04 e R9-3-05 (a) (auditoria de 2026-10-06): sem o Desfazer, a
  // exclusão que pousa com a foto JÁ fechada redesenha o MESMO pedido. O foco que
  // o Tab levou ao ✕ do card ia pra foto do card (`tabindex=-1`, fora do Tab: o
  // Enter seguinte não decidia nada), e nada era dito ao leitor de tela. O foco
  // fica no ✕, e a região do card diz "Foto excluída". CONTROLES: o foco que o
  // Esc deixou na foto do card segue nela (a regra de antes); e a região do card
  // é ESVAZIADA antes da resposta, pra o "Foto excluída" ser desta resposta.
  const noCard = () => page.evaluate(() => {
    const c = cardDaFrente();
    const a = document.activeElement;
    return { noX: !!(c && a === c.querySelector('.card-btn-reject')), naFoto: !!(c && a === c.querySelector('.card-image')),
      frente: AppState.currentPlace && AppState.currentPlace.updateRequestID, fotos: AppState.currentPlace && AppState.currentPlace.imageUrls.length };
  });
  for (const noX of [true, false]) {
    const rot = noX ? 'o foco no ✕' : 'CONTROLE, o foco na foto do card';
    await montar(FOTO_PL, { semDesfazer: true });
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await esperarOuExplodir(page, () => Lightbox.isOpen() && fotoDoLightboxNaTela(), 'a foto ampliada');
    await page.keyboard.press('ArrowRight');            // a foto já no mapa: a lixeira
    await esperarOuExplodir(page, () => fotoDoLightboxNaTela()
      && !document.getElementById('lightboxDelete').classList.contains('hidden'), 'a lixeira da foto no mapa');
    const solta = segurar('excluir-foto');
    await page.focus('#lightboxDelete'); await page.keyboard.press('Enter');
    await esperarOuExplodir(page, () => excluindoAgora === true, 'a exclusão no ar');
    await page.keyboard.press('Escape');
    await esperarOuExplodir(page, () => !Lightbox.isOpen(), 'a foto fechar');
    if (noX) {
      for (let i = 0; i < 25 && !(await noCard()).noX; i++) await page.keyboard.press('Tab');
    }
    const antes = await noCard();
    checa(noX ? antes.noX : antes.naFoto, `foco/exclusão com a foto fechada (${rot}): PRÉ-CONDIÇÃO — o foco não está onde o caso pede`, JSON.stringify(antes));
    await page.evaluate(() => { document.getElementById('cardLiveRegion').textContent = ''; });
    solta({ success: true });
    await esperarOuExplodir(page, () => !excluindoAgora, 'a exclusão pousar');
    await doisQuadros(page);
    const depois = await noCard();
    const s = await regiaoDoCard();
    checa(depois.frente === 'pend-01' && depois.fotos === 1,
      `foco/exclusão com a foto fechada (${rot}): PRÉ-CONDIÇÃO — o card não foi redesenhado sem a foto`, JSON.stringify(depois));
    checa(noX ? depois.noX : depois.naFoto,
      `foco/exclusão com a foto fechada (${rot}): o redesenho do MESMO pedido tirou o foco de onde ele estava`, JSON.stringify(depois));
    checa(s === 'Foto excluída', `anúncio/exclusão com a foto fechada (${rot}): a região do card terminou dizendo ${JSON.stringify(s)}`);
  }

  // ── R9-3-05 (b) (auditoria de 2026-10-06): o Desfazer de uma exclusão com a
  // foto ABERTA traz a foto de volta e ela passa a ser a da tela — e nada era
  // dito. A região da camada diz a foto que voltou (a posição: "Foto 2 de 2").
  // CONTROLE: a região é esvaziada antes do Desfazer (a → que levou à foto já
  // escreveu "Foto 2 de 2"), e a foto que voltou é a da tela.
  {
    await montar(FOTO_PL);
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await esperarOuExplodir(page, () => Lightbox.isOpen() && fotoDoLightboxNaTela(), 'a foto ampliada');
    await page.keyboard.press('ArrowRight');
    await esperarOuExplodir(page, () => fotoDoLightboxNaTela()
      && !document.getElementById('lightboxDelete').classList.contains('hidden'), 'a lixeira da foto no mapa');
    await page.focus('#lightboxDelete'); await page.keyboard.press('Enter');
    await esperarOuExplodir(page, () => !!document.getElementById('undoBtn') && Lightbox.urls.length === 1, 'o Desfazer da exclusão');
    await page.evaluate(() => { document.getElementById('lightboxAnuncio').textContent = ''; });
    await page.focus('#undoBtn'); await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const d = await page.evaluate(() => ({ aberta: Lightbox.isOpen(), n: Lightbox.urls.length, idx: Lightbox.idx,
      anuncio: document.getElementById('lightboxAnuncio').textContent }));
    checa(d.aberta && d.n === 2 && d.idx === 1, 'anúncio/Desfazer da foto: PRÉ-CONDIÇÃO — a foto não voltou pra tela', JSON.stringify(d));
    checa(d.anuncio === 'Foto 2 de 2', `anúncio/Desfazer da foto: a foto voltou à tela e a região da camada disse ${JSON.stringify(d.anuncio)}`);
  }

  // ── R14-3-01 (auditoria da rodada 14): a MESMA frase outra vez na região viva.
  // A região da camada era reescrita com o MESMO texto, sem limpar antes — e
  // região viva reescrita igual pode não ser lida de novo (o R12-5-02, na
  // conversa). (a) O Desfazer de uma exclusão com a região AINDA dizendo a
  // navegação ("Foto 2 de 2" — o caso comum, que o bloco de cima esvazia de
  // propósito): ela é LIMPA e a frase volta numa tarefa à parte. (b) Sem o
  // Desfazer, a 2ª exclusão seguida ("Foto excluída" duas vezes). O observador
  // anota cada mudança, com a hora. CONTROLES: o Desfazer com a região vazia diz a
  // frase na hora, numa mudança só, e a 1ª exclusão (a região dizia a navegação)
  // também — a medida enxerga a frase que não precisa de atraso.
  const observarRegiao = () => page.evaluate(() => {
    const el = document.getElementById('lightboxAnuncio');
    window.__regiaoR14 = [];
    if (window.__obsR14) window.__obsR14.disconnect();
    window.__obsR14 = new MutationObserver(() => window.__regiaoR14.push([el.textContent, performance.now()]));
    window.__obsR14.observe(el, { childList: true, characterData: true, subtree: true });
    return el.textContent;
  });
  // A espera vai à página SERIALIZADA, sem as variáveis daqui (gotcha #28): o
  // que ela confere vai antes, pela janela.
  const mudancasDaRegiao = async (frase, vezes) => {
    await page.evaluate((a) => { window.__esperaR14 = a; }, { frase, vezes });
    await esperarOuExplodir(page, () => window.__regiaoR14.filter(([t]) => t === window.__esperaR14.frase).length
      >= window.__esperaR14.vezes, `a região dizer "${frase}" (${vezes}×)`);
    await page.waitForTimeout(300);                  // e nada mudando depois
    return page.evaluate(() => {
      const r = window.__regiaoR14;
      window.__obsR14.disconnect();
      return { textos: r.map(([t]) => t), ms: r.map(([, t], i) => (i ? Math.round(t - r[i - 1][1]) : 0)) };
    });
  };
  for (const esvazia of [false, true]) {
    const rot = esvazia ? 'CONTROLE, a região vazia antes do Desfazer' : 'a região ainda dizendo a navegação';
    await montar(FOTO_PL);
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await esperarOuExplodir(page, () => Lightbox.isOpen() && fotoDoLightboxNaTela(), 'a foto ampliada');
    await page.keyboard.press('ArrowRight');
    await esperarOuExplodir(page, () => fotoDoLightboxNaTela()
      && !document.getElementById('lightboxDelete').classList.contains('hidden'), 'a lixeira da foto no mapa');
    await page.focus('#lightboxDelete'); await page.keyboard.press('Enter');
    await esperarOuExplodir(page, () => !!document.getElementById('undoBtn') && Lightbox.urls.length === 1, 'o Desfazer da exclusão');
    if (esvazia) await page.evaluate(() => { document.getElementById('lightboxAnuncio').textContent = ''; });
    const antes = await observarRegiao();
    checa(antes === (esvazia ? '' : 'Foto 2 de 2'), `anúncio/R14-3-01 (a) ${rot}: PRÉ-CONDIÇÃO — a região dizia ${JSON.stringify(antes)} antes do Desfazer`);
    await page.focus('#undoBtn'); await page.keyboard.press('Enter');
    const m = await mudancasDaRegiao('Foto 2 de 2', 1);
    if (esvazia) {
      checa(JSON.stringify(m.textos) === '["Foto 2 de 2"]', `anúncio/R14-3-01 (a) ${rot}: a frase não saiu na hora, numa mudança só`, JSON.stringify(m));
    } else {
      checa(JSON.stringify(m.textos) === '["","Foto 2 de 2"]' && m.ms[1] >= 50,
        'anúncio/R14-3-01 (a): o Desfazer reescreveu na região a MESMA frase da navegação, sem limpar antes numa tarefa à parte — a foto que voltou pode não ser dita',
        JSON.stringify(m));
    }
  }
  {
    // (b): a proposta e DUAS fotos já no mapa, sem o Desfazer — a camada segue
    // aberta depois das duas exclusões.
    const TRES = { ...FOTO_PL, venueID: 'v-r14-tres', updateRequestID: 'pend-r14-3',
      imageUrls: [`${foto}#pend-r14-3`, `${foto}#aprovada-r14-a`, `${foto}#aprovada-r14-b`],
      approvedImageIds: ['aprovada-r14-a', 'aprovada-r14-b'] };
    await montar(TRES, { semDesfazer: true });
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await esperarOuExplodir(page, () => Lightbox.isOpen() && fotoDoLightboxNaTela(), 'a foto ampliada');
    await page.keyboard.press('ArrowRight');
    const excluir = async (n) => {
      await esperarOuExplodir(page, () => fotoDoLightboxNaTela() && !excluindoAgora
        && !document.getElementById('lightboxDelete').classList.contains('hidden')
        && !document.getElementById('lightboxDelete').disabled, `a lixeira da ${n}ª foto no mapa`);
      await page.evaluate((resta) => { window.__restamR14 = resta; }, 3 - n);
      await page.focus('#lightboxDelete'); await page.keyboard.press('Enter');
      await esperarOuExplodir(page, () => !excluindoAgora && Lightbox.urls.length === window.__restamR14, `a ${n}ª exclusão pousar`);
    };
    const antes = await observarRegiao();
    checa(antes === 'Foto 2 de 3', `anúncio/R14-3-01 (b): PRÉ-CONDIÇÃO — a região dizia ${JSON.stringify(antes)} antes da 1ª exclusão`);
    await excluir(1);
    await excluir(2);
    const m = await mudancasDaRegiao('Foto excluída', 2);
    const d = await page.evaluate(() => ({ aberta: Lightbox.isOpen(), n: Lightbox.urls.length }));
    checa(d.aberta && d.n === 1, 'anúncio/R14-3-01 (b): PRÉ-CONDIÇÃO — as duas exclusões não pousaram com a camada aberta', JSON.stringify(d));
    checa(JSON.stringify(m.textos) === '["Foto excluída","","Foto excluída"]' && m.ms[2] >= 50,
      'anúncio/R14-3-01 (b): sem o Desfazer, a 2ª exclusão reescreveu "Foto excluída" igual, sem limpar antes numa tarefa à parte (ou a 1ª não saiu na hora — o CONTROLE)',
      JSON.stringify(m));
  }

  // ── Rodada 10 (auditoria de 2026-10-07): R10-3-01 a 04 ─────────────────────
  // O selo da foto que volta numa camada REABERTA (01), a camada do IRMÃO que
  // muda calada (02), duas exclusões do MESMO local no ar ao mesmo tempo (03) e a
  // proposta já aprovada que voltava com o ✨ e os dois botões no mesmo canto (04).
  // Cada caso mede ANTES do desfecho o estado que o defeito precisa (PRÉ-CONDIÇÃO),
  // e a medida enxerga o que procura (CONTROLE). Reabrir só depois de o voltar da
  // camada fechada assentar (`CamadaVoltar.consumindo`, gotcha #65).
  const selo = () => page.evaluate(() => {
    const b = document.getElementById('lightboxNewBadge');
    const minis = [...document.querySelectorAll('#lightboxStrip .lb-mini')]
      .map((x) => (x.querySelector('.lb-mini-selo') || {}).textContent || '·').join('');
    return { visivel: !b.classList.contains('hidden'), txt: b.textContent, nome: b.getAttribute('aria-label'), minis,
      anuncio: document.getElementById('lightboxAnuncio').textContent, n: Lightbox.urls.length, idx: Lightbox.idx,
      janela: !!document.getElementById('undoBtn') };
  });
  const canto = () => page.evaluate(() => {
    const est = (id) => { const b = document.getElementById(id); return b.classList.contains('hidden') ? '—' : (b.disabled ? 'travado' : 'vivo'); };
    const vivo = ['lightboxApprove', 'lightboxDelete'].map((id) => document.getElementById(id)).find((b) => !b.classList.contains('hidden'));
    let dedo = null;
    if (vivo) {
      const r = vivo.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      dedo = el && (el.closest('button') || el).id;
    }
    const b = document.getElementById('lightboxNewBadge');
    return { aprovar: est('lightboxApprove'), lixeira: est('lightboxDelete'), selo: b.classList.contains('hidden') ? null : b.textContent, dedo };
  });

  // R10-3-01: a foto DENUNCIADA excluída com o Desfazer, a foto fechada e
  // REABERTA pelo card dentro da janela (ela nasce do card, sem a denunciada), e
  // o Desfazer: a denunciada volta com o 🚩 — ia o ✨ "foto nova", na camada, na
  // tira e no anúncio. CONTROLE: a primeira abertura lê o 🚩 (a medida acha o selo).
  {
    const FLAG_PL = { ...FOTO_PL, venueID: 'v-r10-flag', updateRequestID: 'u-r10-flag', updateTypeKey: 'FLAG',
      reqType: 'REQUEST', reqSubType: 'FLAG', purType: 'FLAGGED_PHOTO', flagSubjectType: 'IMAGE',
      flagEntityID: 'denunciada-r10', imageUrls: [`${foto}#denunciada-r10`, `${foto}#aprovada-r10`],
      approvedImageIds: ['denunciada-r10', 'aprovada-r10'] };
    await montar(FLAG_PL);
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await esperarOuExplodir(page, () => Lightbox.isOpen() && fotoDoLightboxNaTela()
      && !document.getElementById('lightboxDelete').classList.contains('hidden'), 'a lixeira da foto denunciada');
    const s0 = await selo();
    checa(s0.visivel && s0.txt === '🚩' && s0.idx === 0 && s0.minis === '🚩·',
      'selo/R10-3-01: PRÉ-CONDIÇÃO — a camada não abriu na denunciada com o 🚩 (a medida leria o selo errado)', JSON.stringify(s0));
    await page.focus('#lightboxDelete'); await page.keyboard.press('Enter');
    await esperarOuExplodir(page, () => !!document.getElementById('undoBtn') && Lightbox.urls.length === 1, 'o Desfazer da exclusão da denunciada');
    await page.keyboard.press('Escape');
    await esperarOuExplodir(page, () => !Lightbox.isOpen() && !CamadaVoltar.consumindo, 'a foto fechar e o voltar assentar');
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await esperarOuExplodir(page, () => Lightbox.isOpen() && fotoDoLightboxNaTela(), 'a foto reaberta pelo card');
    const s1 = await selo();
    checa(!s1.visivel && s1.n === 1 && s1.janela, 'selo/R10-3-01: PRÉ-CONDIÇÃO — a camada reaberta na janela não nasceu sem a denunciada', JSON.stringify(s1));
    await page.evaluate(() => { document.getElementById('lightboxAnuncio').textContent = ''; });
    await page.focus('#undoBtn'); await page.keyboard.press('Enter');
    await esperarOuExplodir(page, () => Lightbox.urls.length === 2, 'a denunciada voltar pelo Desfazer');
    await doisQuadros(page);
    const s2 = await selo();
    checa(s2.visivel && s2.txt === '🚩' && s2.nome === s0.nome && s2.minis === '🚩·' && s2.anuncio.endsWith(s0.nome),
      `selo/R10-3-01: a foto DENUNCIADA voltou à camada reaberta com ${JSON.stringify(s2.txt)} — o ✨ "foto nova" no lugar do 🚩`, JSON.stringify(s2));
  }

  // R10-3-02: sem o Desfazer, a exclusão de A pousa com a foto ampliada do IRMÃO
  // B (o mesmo local, na frente depois do ✕ em A) aberta: a foto sai da camada de
  // B e a região DELA diz. CONTROLE: com a camada do próprio A aberta, a região já
  // dizia (a medida enxerga a região).
  for (const irmao of [true, false]) {
    const rot = irmao ? 'a camada do irmão' : 'CONTROLE, a camada do próprio pedido';
    const B_PL = { ...FOTO_PL, updateRequestID: 'pend-r10-b', imageUrls: [`${foto}#pend-r10-b`, `${foto}#aprovada-02`],
      approvedImageIds: ['aprovada-02'] };
    await montar(FOTO_PL, { semDesfazer: true, depois: [B_PL] });
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await esperarOuExplodir(page, () => Lightbox.isOpen() && fotoDoLightboxNaTela(), 'a foto ampliada de A');
    await page.keyboard.press('ArrowRight');
    await esperarOuExplodir(page, () => fotoDoLightboxNaTela()
      && !document.getElementById('lightboxDelete').classList.contains('hidden'), 'a lixeira da foto no mapa');
    const solta = segurar('excluir-foto');
    await page.focus('#lightboxDelete'); await page.keyboard.press('Enter');
    await esperarOuExplodir(page, () => excluindoAgora === true, 'a exclusão no ar');
    if (irmao) {
      await page.keyboard.press('Escape');
      await esperarOuExplodir(page, () => !Lightbox.isOpen() && !CamadaVoltar.consumindo, 'a foto de A fechar');
      await page.focus('#cardStack .place-card:not(.card-fundo) .card-btn-reject');
      await page.keyboard.press('Enter');             // A decidido: sem o Desfazer, sai na hora
      await esperarOuExplodir(page, () => !!AppState.currentPlace && AppState.currentPlace.updateRequestID === 'pend-r10-b'
        && !acoesTravadas(), 'o irmão B na frente');
      await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
      await esperarOuExplodir(page, () => Lightbox.isOpen() && fotoDoLightboxNaTela(), 'a foto ampliada do irmão');
    }
    const antes = await page.evaluate(() => ({ de: Lightbox.place && Lightbox.place.updateRequestID, n: Lightbox.urls.length }));
    checa(antes.de === (irmao ? 'pend-r10-b' : 'pend-01') && antes.n === 2,
      `anúncio/R10-3-02 (${rot}): PRÉ-CONDIÇÃO — a camada aberta não é a esperada, com as duas fotos`, JSON.stringify(antes));
    await page.evaluate(() => { for (const id of ['lightboxAnuncio', 'cardLiveRegion']) document.getElementById(id).textContent = ''; });
    solta({ success: true, restantes: [] });
    await esperarOuExplodir(page, () => !excluindoAgora, 'a exclusão pousar');
    await doisQuadros(page);
    const d = await page.evaluate(() => ({ aberta: Lightbox.isOpen(), n: Lightbox.urls.length,
      camada: document.getElementById('lightboxAnuncio').textContent, card: document.getElementById('cardLiveRegion').textContent }));
    checa(d.aberta && d.n === 1, `anúncio/R10-3-02 (${rot}): PRÉ-CONDIÇÃO — a foto não saiu da camada aberta`, JSON.stringify(d));
    checa(d.camada === 'Foto excluída' && d.card === '',
      `anúncio/R10-3-02 (${rot}): a foto saiu da camada aberta e a região dela disse ${JSON.stringify(d.camada)} (a do card: ${JSON.stringify(d.card)})`);
  }

  // R10-3-03: com o Desfazer, duas exclusões no MESMO local. A janela da 1ª vence
  // e ela fica no ar (o Waze de mentira a segura); a lixeira volta a valer e a 2ª
  // é pedida — a janela dela vence e ela NÃO sai enquanto a 1ª não responder (o
  // servidor relê a lista que a 1ª deixou), e a releitura não é aquecida com o
  // local no ar. CONTROLE: com a resposta da 1ª, a 2ª SAI (a medida enxerga a ida).
  {
    const TRES = { ...FOTO_PL, venueID: 'v-r10-tres', updateRequestID: 'pend-r10-3',
      imageUrls: [`${foto}#pend-r10-3`, `${foto}#aprovada-r10-a`, `${foto}#aprovada-r10-b`],
      approvedImageIds: ['aprovada-r10-a', 'aprovada-r10-b'] };
    const idas = [];
    const presas = [];
    const rota = async (route) => {
      let corpo = {};
      try { corpo = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* sem corpo */ }
      const preparar = corpo.action === 'preparar';
      idas.push({ id: corpo.imageID, preparar });
      if (!preparar) await new Promise((ok) => presas.push(ok));
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(preparar ? { success: true, preparado: true } : { success: true, restantes: [] }) });
    };
    await page.route('**/api/excluir-foto', rota);     // registrada depois: é ela que responde
    const exclusoes = () => idas.filter((i) => !i.preparar).map((i) => i.id);
    const aquecidas = () => idas.filter((i) => i.preparar).length;
    const ate = async (cond, oQue, teto = 15000) => {   // pelo lado do NODE: o registro é daqui
      const t0 = Date.now();
      while (!cond()) {
        if (Date.now() - t0 > teto) throw new Error(`a espera por ${oQue} estourou (${teto}ms)`);
        await dormir(50);
      }
    };
    await montar(TRES);
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await esperarOuExplodir(page, () => Lightbox.isOpen() && fotoDoLightboxNaTela(), 'a foto ampliada');
    await page.keyboard.press('ArrowRight');
    const lixeiraViva = () => esperarOuExplodir(page, () => fotoDoLightboxNaTela()
      && !document.getElementById('lightboxDelete').classList.contains('hidden')
      && !document.getElementById('lightboxDelete').disabled, 'a lixeira viva');
    await lixeiraViva();
    await page.focus('#lightboxDelete'); await page.keyboard.press('Enter');   // a 1ª, com a janela
    await ate(() => exclusoes().length === 1, 'a 1ª exclusão sair (a janela vencer)');
    await lixeiraViva();                                // a janela acabou: a lixeira da foto seguinte vale
    await page.focus('#lightboxDelete'); await page.keyboard.press('Enter');   // a 2ª, com a 1ª no ar
    await esperarOuExplodir(page, () => !!exclusaoPendente, 'a janela da 2ª');
    await esperarOuExplodir(page, () => !exclusaoPendente, 'a janela da 2ª vencer');
    await dormir(600);                                  // o tempo de a ida chegar à rota, se ela saísse
    const meio = { exclusoes: exclusoes(), aquecidas: aquecidas() };
    checa(meio.exclusoes.length === 1,
      'exclusão/R10-3-03: a 2ª exclusão do local saiu com a 1ª no ar — o servidor relê a lista de antes, e uma delas se desfaz no Waze', JSON.stringify(meio));
    checa(meio.aquecidas === 1, 'exclusão/R10-3-03: o gesto da 2ª aqueceu a releitura com a 1ª no ar', JSON.stringify(meio));
    presas.shift()();                                   // a resposta da 1ª
    await ate(() => exclusoes().length === 2, 'a 2ª sair depois da resposta da 1ª').catch((e) => checa(false, 'exclusão/R10-3-03: CONTROLE — ' + e.message));
    checa(JSON.stringify(exclusoes()) === JSON.stringify(['aprovada-r10-a', 'aprovada-r10-b']),
      'exclusão/R10-3-03: CONTROLE — as duas exclusões não saíram na ordem dos gestos', JSON.stringify(exclusoes()));
    while (presas.length) presas.shift()();
    await page.unroute('**/api/excluir-foto', rota);
  }

  // R10-3-04: aprovar com o Desfazer, fechar a foto (o fechamento despacha a
  // aprovação, que fica no ar) e REABRIR pelo card: sem o ✨ e só a lixeira no
  // canto (travada até a resposta); com a resposta, a lixeira viva e o dedo nela.
  // CONTROLE: a proposta abre com o ✨ e o "Aprovar", e o dedo pega o "Aprovar".
  {
    await montar(FOTO_PL);
    const solta = segurar('validar-place');
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await esperarOuExplodir(page, () => Lightbox.isOpen() && fotoDoLightboxNaTela()
      && !document.getElementById('lightboxApprove').classList.contains('hidden'), 'o "Aprovar" da proposta');
    const c0 = await canto();
    checa(c0.selo === '✨' && c0.aprovar === 'vivo' && c0.lixeira === '—' && c0.dedo === 'lightboxApprove',
      'canto/R10-3-04: PRÉ-CONDIÇÃO — a proposta não abriu com o ✨ e o "Aprovar"', JSON.stringify(c0));
    await page.focus('#lightboxApprove'); await page.keyboard.press('Enter');   // com a janela do Desfazer
    await esperarOuExplodir(page, () => !!document.getElementById('undoBtn'), 'a janela da aprovação');
    await page.keyboard.press('Escape');                // o fechamento despacha a aprovação
    await esperarOuExplodir(page, () => !Lightbox.isOpen() && !CamadaVoltar.consumindo && aprovacoesNoAr.size === 1,
      'a aprovação no ar, com a foto fechada');
    await page.click('#cardStack .place-card:not(.card-fundo) .card-image');
    await esperarOuExplodir(page, () => Lightbox.isOpen() && fotoDoLightboxNaTela(), 'a foto reaberta pelo card');
    await doisQuadros(page);
    const c1 = await canto();
    checa(c1.selo === null && c1.aprovar === '—' && c1.lixeira !== '—',
      'canto/R10-3-04: reaberta com a aprovação no ar, a camada mostrou o ✨ na foto aprovada e/ou o "Aprovar" no canto da lixeira', JSON.stringify(c1));
    solta({ success: true });
    await esperarOuExplodir(page, () => aprovacoesNoAr.size === 0 && placeResolvidoPorAprovacao !== null, 'a aprovação pousar');
    await doisQuadros(page);
    const c2 = await canto();
    checa(c2.selo === null && c2.aprovar === '—' && c2.lixeira === 'vivo' && c2.dedo === 'lightboxDelete',
      'canto/R10-3-04: com a resposta, o canto não ficou só com a lixeira viva (o "Aprovar" voltou, ou o dedo pega outro)', JSON.stringify(c2));
  }
  checa(erros.length === 0, 'foco: erro de JS', erros[0]);
  await ctx.close();
}

// ── A RODA do mouse e o trackpad (auditoria de 2026-09-26) ─────────────────
//
// No mapa ampliado cada EVENTO de roda era um nível: 20 eventos de trackpad de
// deltaY −4 (menos que UM dente de mouse, 100) subiam do 17 ao 19. E a rolagem
// só HORIZONTAL caía no "afastar", no mapa (6 rolagens: do 17 ao 11) e na foto.
// O CONTROLE é o dente de mouse, que tem que continuar dando um nível (mapa) e
// 1,2× (foto): sem ele, "o zoom não mudou" passaria também com a roda que não
// chega ao elemento.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('**/*-tiles/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_CINZA }));
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 80)));
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, places: [], hasMore: false, total: 0 }) }));
  await presencaViva(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  const PL = {
    venueID: 'v-roda', updateRequestID: 'pend-01', name: 'Padaria', categories: ['BAKERY'], address: 'Rua X, 1',
    updateTypeKey: 'IMAGE', reqType: 'IMAGE', purType: 'NEW_PHOTO', createdBy: 'wazer', lat: -12.9, lon: -38.3,
    changes: [], imageUrls: [`${foto}#pend-01`], approvedImageIds: [],
    mapa: { centro: [-12.9, -38.3], proposto: null, movidoM: null, entradas: [] },
  };
  await page.evaluate((p0) => {
    setLang('pt'); applyI18n();
    API.setSession('tok-smoke');
    AppState.authenticated = true;
    AppState.profile = { id: 1, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false };
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    document.getElementById('noMoreCards').classList.add('hidden');
    showLoading(false);
    const p = JSON.parse(JSON.stringify(p0));
    AppState.queue = [p]; AppState.currentPlace = p;
    document.querySelectorAll('.place-card').forEach((e) => e.remove());
    showCurrentPlace();
  }, PL);
  await assentar(page);
  const rodar = async (n, dx, dy) => { for (let i = 0; i < n; i++) await page.mouse.wheel(dx, dy); await page.waitForTimeout(80); };
  const pausa = () => page.waitForTimeout(350);   // gesto NOVO (o acumulado do mapa recomeça em 250 ms)
  // O MAPA.
  await page.evaluate(() => MapaLightbox.open(AppState.currentPlace));
  await page.waitForTimeout(400);
  await page.mouse.move(640, 400);
  const z = () => page.evaluate(() => MapaLightbox.z);
  const z0 = await z();
  await rodar(1, 0, -100);
  const z1 = await z();
  checa(z1 === z0 + 1, `roda/mapa: CONTROLE — um dente de mouse não aproximou um nível (z ${z0} → ${z1}): a roda não chega`);
  await pausa();
  await rodar(20, 0, -4);
  const z2 = await z();
  checa(z2 === z1, `roda/mapa: 20 eventos de trackpad (−80, menos que um dente) mudaram o zoom (z ${z1} → ${z2})`);
  await pausa();
  await rodar(25, 0, -4);
  const z3 = await z();
  checa(z3 === z2 + 1, `roda/mapa: o trackpad somando um dente (−100) não deu UM nível (z ${z2} → ${z3})`);
  await pausa();
  await rodar(6, 40, 0);
  const z4 = await z();
  checa(z4 === z3, `roda/mapa: rolagem só HORIZONTAL mexeu no zoom (z ${z3} → ${z4})`);
  // O DUPLO TOQUE com o tremor de um dedo (L15): qualquer movimento virava
  // arraste, e com 1 px o mapa não aproximava (a foto aproxima com 3). Mouse
  // de verdade, que gera o mesmo pointer + click do toque. O CONTROLE é o
  // arraste de 40 px, que não pode contar como toque.
  const tocar = async (x, y, mexe) => {
    await page.mouse.move(x, y); await page.mouse.down();
    if (mexe) await page.mouse.move(x + mexe, y + mexe, { steps: 2 });
    await page.mouse.up();
  };
  // Volta ao pedido: a roda acima levou o zoom ao 19, o MÁXIMO, e ali nenhum
  // toque aproxima (a medida estaria cega — foi o que a 1ª versão mediu).
  await page.evaluate(() => MapaLightbox.recentrar());
  await pausa();
  const zt0 = await z();
  checa(zt0 < await page.evaluate(() => MAPA_Z_NAV_MAX), `duplo toque/mapa: PRÉ-CONDIÇÃO — o zoom ${zt0} já é o máximo`);
  await tocar(640, 400, 2); await tocar(640, 400, 2);
  await page.waitForTimeout(250);
  const zt1 = await z();
  checa(zt1 === zt0 + 1, `duplo toque/mapa: com 2 px de tremor não aproximou (z ${zt0} → ${zt1})`);
  await pausa();
  // O 2º toque cai onde o arraste TERMINOU: a régua da distância entre os
  // toques não pode ser o que segura o controle — é a folga do arraste.
  await tocar(640, 400, 40); await tocar(680, 440, 0);
  await page.waitForTimeout(250);
  const zt2 = await z();
  checa(zt2 === zt1, `duplo toque/mapa: CONTROLE — um ARRASTE seguido de um toque aproximou (z ${zt1} → ${zt2})`);
  // O "+" no zoom MÁXIMO e o "−" no MÍNIMO (R7-3-09, auditoria de 2026-10-02):
  // o toque não faz nada e eles seguiam com cara de vivos. Agora `aria-disabled`
  // e esmaecidos (o PIXEL: a opacidade computada) — e o foco de quem chegou pelo
  // TECLADO fica no botão (com `disabled` ele cairia no <body>). CONTROLE: o
  // outro botão, no mesmo instante, vivo e opaco.
  const limite = () => page.evaluate(() => {
    const m = document.getElementById('mapaLbMais'), n = document.getElementById('mapaLbMenos');
    return { z: MapaLightbox.z, mais: m.getAttribute('aria-disabled'), opMais: Number(getComputedStyle(m).opacity),
      menos: n.getAttribute('aria-disabled'), opMenos: Number(getComputedStyle(n).opacity),
      foco: document.activeElement && document.activeElement.id, maisDis: m.disabled };
  });
  await page.evaluate(() => { while (MapaLightbox.z < MAPA_Z_NAV_MAX - 1) MapaLightbox.zoom(1); });
  await page.focus('#mapaLbMais');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');   // o 2º já no limite
  await page.waitForTimeout(150);
  const noMax = await limite();
  checa(noMax.z === await page.evaluate(() => MAPA_Z_NAV_MAX), `zoom/mapa: PRÉ-CONDIÇÃO — o Enter no "+" não levou ao máximo (z ${noMax.z})`);
  checa(noMax.mais === 'true' && noMax.opMais < 0.6 && !noMax.maisDis,
    'zoom/mapa: no zoom máximo o "+" segue com cara de vivo (sem aria-disabled ou sem esmaecer) — ou virou `disabled`', JSON.stringify(noMax));
  checa(noMax.menos === null && noMax.opMenos === 1, 'zoom/mapa: CONTROLE — no máximo o "−" (vivo) travou ou esmaeceu', JSON.stringify(noMax));
  checa(noMax.foco === 'mapaLbMais', 'zoom/mapa: o "+" travado no máximo perdeu o foco do teclado', JSON.stringify(noMax));
  await page.evaluate(() => { while (MapaLightbox.z > MAPA_Z_NAV_MIN) MapaLightbox.zoom(-1); });
  await page.waitForTimeout(150);
  const noMin = await limite();
  checa(noMin.menos === 'true' && noMin.opMenos < 0.6 && noMin.mais === null && noMin.opMais === 1,
    'zoom/mapa: no zoom mínimo o "−" segue com cara de vivo (ou o "+" não voltou a valer)', JSON.stringify(noMin));
  await page.evaluate(() => MapaLightbox.close());
  await page.waitForTimeout(250);
  // A FOTO.
  await page.evaluate(() => { const p = AppState.currentPlace; Lightbox.open(p.imageUrls, 0, 0, p.name, false, p); });
  await page.waitForTimeout(400);
  await page.mouse.move(640, 400);
  const escala = () => page.evaluate(() => Lightbox.scale);
  await rodar(1, 0, -100);
  const e1 = await escala();
  checa(Math.abs(e1 - 1.2) < 0.01, `roda/foto: CONTROLE — um dente de mouse não deu o 1,2× (escala ${e1})`);
  // A horizontal medida COM zoom: em 1× o "afastar" batia no piso e não se via.
  await rodar(6, 40, 0);
  const e0 = await escala();
  checa(Math.abs(e0 - e1) < 1e-9, `roda/foto: rolagem só HORIZONTAL mexeu no zoom (escala ${e1.toFixed(2)} → ${e0.toFixed(2)})`);
  await pausa();
  await rodar(20, 0, -4);
  const e2 = await escala();
  // proporcional: −80 é 0,8 dente → 1,2 × 1,2^0,8 ≈ 1,39 (por evento dava 4, o teto)
  checa(e2 > e1 && e2 < 1.5, `roda/foto: 20 eventos de trackpad (−80) foram de ${e1.toFixed(2)} a ${e2.toFixed(2)} — por evento, não pelo delta`);
  // Ir e voltar na MESMA medida volta a 1× EXATO (R6-3-05, auditoria de
  // 2026-10-01): o zoom é produto de fatores, e dois dentes de 53 px (o do
  // Chrome no Linux) pra dentro e dois pra fora paravam em 1,0000000000000002 —
  // a tela parecia 1×, mas as setas ANDAVAM a foto e o ↓ não fechava. CONTROLE:
  // os dentes de 53 px aproximaram de verdade antes de voltar.
  await page.evaluate(() => Lightbox.resetZoom());
  await pausa();
  await rodar(2, 0, -53);
  const e3 = await escala();
  checa(e3 > 1.1, `roda/foto: CONTROLE — dois dentes de 53 px não aproximaram (escala ${e3})`);
  await rodar(2, 0, 53);
  const e4 = await escala();
  checa(e4 === 1, `roda/foto: dois dentes de 53 px pra dentro e dois pra fora pararam em ${e4}, não em 1× — as setas andariam a foto`);
  // E a roda FINA a partir de 1× (R7-3-03, auditoria de 2026-10-02): o "abaixo de
  // 0,1% é 1×" de cima engolia todo evento menor que ~0,55 px, e a roda fina e a
  // pinça lenta do trackpad nunca começavam a ampliar (40 eventos de −0,4 px e a
  // escala parada em 1). Agora ela volta a 1 só AFASTANDO: 40 de −0,4 ampliam
  // (1,2^0,16 ≈ 1,03) e 40 de +0,4 voltam a 1× EXATO.
  // O estado da foto e a foto com DUAS imagens (pra a → ter o que trocar): os
  // trechos abaixo, o do Chromium e o dos dois motores, medem por eles.
  const estadoDaFoto = () => page.evaluate(() => ({ escala: Lightbox.scale, idx: Lightbox.idx, aberta: Lightbox.isOpen(),
    transform: document.getElementById('lightboxImage').style.transform || '' }));
  const abrirComDuas = async () => {
    await page.evaluate(() => { if (Lightbox.isOpen()) Lightbox.close(); });
    await page.waitForTimeout(250);   // fechar e abrir no mesmo tique é o gotcha #65
    await page.evaluate((outra) => { const p = AppState.currentPlace; Lightbox.open([p.imageUrls[0], outra], 0, -1, p.name, false, p); },
      `${foto}#outra-r8`);
    await page.waitForTimeout(400);
    await page.mouse.move(640, 400);
  };
  const txDe = (tr) => { const m = /translate\((-?[\d.e-]+)px/.exec(tr); return m ? Number(m[1]) : 0; };
  if (!pularForaDoChromium(MOTOR, 'roda/foto: a roda FINA (eventos de −0,4 px) a partir de 1×',
    'o WebKit do Playwright descarta a roda com |delta| abaixo de 1 px (MEDIDO: 10 eventos de −0,4 px, nenhum chegou à página; os de −1 e −4 chegam), e o defeito mora abaixo de ~0,55 px')) {
    await pausa();
    await rodar(40, 0, -0.4);
    const e5 = await escala();
    checa(e5 > 1.02, `roda/foto: 40 eventos de roda de −0,4 px a partir de 1× não ampliaram (escala ${e5}) — a roda fina e a pinça lenta morrem`);
    await rodar(40, 0, 0.4);
    const e6 = await escala();
    checa(e6 === 1, `roda/foto: afastando os mesmos 40 eventos a escala parou em ${e6}, não em 1×`);
    // E UM evento só (R8-3-01, auditoria de 2026-10-03): o passo fino fica
    // guardado (1,00073, a foto de 800 px com 801) e a tela segue em 1× — mas as
    // setas a tratavam como AMPLIADA: a → ANDAVA a foto 80 px em vez de trocá-la,
    // e o ↓ a andava em vez de fechar. Com duas fotos, pra a → ter o que trocar.
    // CONTROLE: com um zoom de verdade (um dente), a → anda a foto.
    await abrirComDuas();
    await rodar(1, 0, -0.4);
    const f0 = await estadoDaFoto();
    checa(f0.escala > 1 && f0.escala < 1.001, `roda/foto: PRÉ-CONDIÇÃO — um evento de −0,4 px deu a escala ${f0.escala}, não o fio invisível`);
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
    const f1 = await estadoDaFoto();
    checa(f1.idx === 1 && !/translate/.test(f1.transform),
      'roda/foto: depois de um fio de zoom invisível, a → andou a foto em vez de trocá-la', JSON.stringify(f1));
    await rodar(1, 0, -0.4);
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(250);
    const f2 = await estadoDaFoto();
    checa(!f2.aberta, 'roda/foto: depois de um fio de zoom invisível, o ↓ andou a foto em vez de fechá-la', JSON.stringify(f2));
    await abrirComDuas();
    await rodar(1, 0, -100);
    const f3 = await estadoDaFoto();
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
    const f4 = await estadoDaFoto();
    checa(f3.escala > 1.1 && f4.idx === 0 && Math.abs(txDe(f4.transform) - txDe(f3.transform) + 80) < 0.5,
      'roda/foto: CONTROLE — ampliada de verdade (um dente), a → deixou de andar a foto 80 px', JSON.stringify({ f3, f4 }));
  }
  // A régua é em PIXELS da foto na tela (R9-3-01, auditoria de 2026-10-06). UM
  // evento de roda de −1 px — o menor que o WebKit entrega, então isto roda nos
  // DOIS motores — dá 1,00182 (a foto de 800 px com 801,5): os 0,1% de antes a
  // contavam como ampliada, e a → ANDAVA a foto e o ↓ a andava em vez de fechar
  // (MEDIDO nos dois motores). CONTROLES: a caixa da <img> que a régua mede É a
  // foto na tela (sem isso a régua mediria outra coisa, calada); o evento passou
  // dos 0,1% (senão o caso não distingue nada); e um zoom que se VÊ (um dente)
  // anda a foto.
  {
    await abrirComDuas();
    const caixa = await page.evaluate(() => {
      const img = document.getElementById('lightboxImage');
      const r = img.getBoundingClientRect();
      return { w: img.offsetWidth, h: img.offsetHeight, naTelaW: r.width, naTelaH: r.height, escala: Lightbox.scale, carregou: fotoDoLightboxNaTela() };
    });
    checa(caixa.carregou && caixa.escala === 1 && Math.abs(caixa.w - caixa.naTelaW) < 1 && Math.abs(caixa.h - caixa.naTelaH) < 1
      && Math.max(caixa.w, caixa.h) > 200,
    'roda/foto R9-3-01: CONTROLE — a caixa da <img> (o `offsetWidth` que a régua lê) não é a foto que a tela mostra', JSON.stringify(caixa));
    await rodar(1, 0, -1);
    const g0 = await estadoDaFoto();
    const aMais = (g0.escala - 1) * Math.max(caixa.w, caixa.h);
    checa(g0.escala > 1.001 && g0.escala < 1.005, `roda/foto R9-3-01: PRÉ-CONDIÇÃO — um evento de −1 px deu a escala ${g0.escala} (+${aMais.toFixed(1)} px), fora da faixa logo acima dos 0,1%`);
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
    const g1 = await estadoDaFoto();
    checa(g1.idx === 1 && !/translate/.test(g1.transform),
      `roda/foto R9-3-01: depois de UM evento de −1 px (+${aMais.toFixed(1)} px, invisível), a → andou a foto em vez de trocá-la`, JSON.stringify(g1));
    await rodar(1, 0, -1);
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(250);
    const g2 = await estadoDaFoto();
    checa(!g2.aberta, 'roda/foto R9-3-01: depois de UM evento de −1 px, o ↓ andou a foto em vez de fechá-la', JSON.stringify(g2));
    await abrirComDuas();
    await rodar(1, 0, -100);
    const g3 = await estadoDaFoto();
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
    const g4 = await estadoDaFoto();
    checa(g3.escala > 1.1 && g4.idx === 0 && Math.abs(txDe(g4.transform) - txDe(g3.transform) + 80) < 0.5,
      'roda/foto R9-3-01: CONTROLE — ampliada de verdade (um dente), a → deixou de andar a foto 80 px', JSON.stringify({ g3, g4 }));
  }
  await page.evaluate(() => Lightbox.close());
  checa(erros.length === 0, 'roda: erro de JS', erros[0]);
  await ctx.close();
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
        await new Promise((k) => setTimeout(k, 90));
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

// ── Os seletores dos Filtros: toda opção do dicionário cabe FECHADA ────────
// A falha da lista de estados ("Não deu pra carregar os estados") saía cortada
// no seletor fechado — em pt, "Não deu pra carregar o", sem o objeto (auditoria
// da rodada 6, R66-3). O seletor não quebra linha nem rola, então "não estoura"
// não se vê por `scrollWidth`.
//
// E a medida é a do PRÓPRIO navegador, não uma conta: um clone do seletor (as
// mesmas classes, no mesmo lugar) com largura automática e só aquela opção diz
// quanto o seletor PRECISA ter pra mostrá-la inteira, e passar da largura real é
// cortar. A conta "texto (canvas) contra `clientWidth` menos os paddings" — a da
// auditoria e a da 1ª versão deste bloco — esquece a caixa da SETA, que o
// seletor reserva dentro do conteúdo: ela deu folga de 14 px a uma frase que a
// tela mostrava com a última letra cortada, e "cabe" ao inglês de antes, que o
// WebKit cortava ("Couldn’t load the state"). Esta acerta a fronteira no
// Chromium (194/200 inteiro, 206/200 cortado, conferido pixel a pixel) e erra
// pra MAIS no WebKit (uns 5 px).
//
// Mede TODA opção que o dicionário escreve nos seletores do modal (as com
// `data-i18n`, todas as da ordem — com as três de distância —, de residencial e
// de região, e o seletor de idioma, na aba Preferências); nome de país, estado,
// área e categoria é dado do Waze e fica de fora. Foi esta varredura que achou o
// "📍 Perto de mim (GPS)" e o "Résidentiel uniquement" cortados no WebKit a
// 280 px (204/200 e 207/200; a tela mostrava "(GPS" e "uniquemen"). A falha dos
// estados vem pelo caminho de verdade: a lista responde 500. CONTROLES: a falha
// TEM que estar no seletor; um texto de 200 caracteres TEM que cortar e um de
// uma letra, não; e a varredura tem que ter medido as opções que já cortaram.
{
  for (const [ap, viewport] of [['Galaxy Fold', { width: 280, height: 653 }], ['iPhone SE', { width: 320, height: 568 }]]) {
    for (const lang of LINGUAS) {
      const onde = `seletores dos Filtros/${ap}/${lang}`;
      const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', locale: 'pt-BR' });
      await ctx.addInitScript((l) => {
        try {
          if (sessionStorage.getItem('__seletores')) return;
          sessionStorage.setItem('__seletores', '1');
          localStorage.setItem('waze_session_token', 'tok-smoke-seletores');
          localStorage.setItem('waze_places_lang', l);
          localStorage.setItem('waze_places_preferences', JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true }));
        } catch (e) { /* armazenamento bloqueado: o teste segue */ }
      }, lang);
      await ctx.route('**/api/**', async (route) => {
        const nome = route.request().url().split('/api/')[1].split(/[?#]/)[0];
        let st = 200;
        let b = { success: true };
        if (nome === 'perfil') {
          // Casa e trabalho no perfil: as três ordens por distância viram opção.
          b = { success: true, visivelNoWme: true, referencias: { casa: [-23.55, -46.63], trabalho: [-23.5, -46.6] },
            profile: { id: 12444348, userName: 'wazer', rank: 5, isAreaManager: true, isStaff: false,
              areas: [], managedAreas: [{ id: 9001, name: 'Área SP' }], editableCountryIDs: [30] } };
        } else if (nome === 'lista-paises') b = { success: true, countries: [{ id: 30, name: 'Brazil' }] };
        else if (nome === 'lista-estados') { st = 500; b = { success: false, errorCategory: 'transient', error: 'x' }; }
        else if (nome === 'buscar-places') b = { success: true, places: [], hasMore: false, page: 1, total: 0, totalAll: 0, blocked: 0 };
        else if (nome === 'presenca-app') b = { success: true, online: [], conversas: [] };
        await route.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(b) }).catch(() => {});
      });
      const page = await ctx.newPage();
      const erros = [];
      page.on('pageerror', (e) => erros.push(String(e.message || e)));
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await esperarOuExplodir(page, () => typeof AppState !== 'undefined' && !!AppState.profile, 'o perfil');
      await page.evaluate(() => { openFiltersModal(); switchFilterTab('filtersTabFilters'); });
      await esperarOuExplodir(page, () => {
        const o = document.querySelector('#filterState option');
        return !!o && o.getAttribute('data-i18n') === 'filters.state.naoCarregou'
          && !!document.querySelector('#filterSort option[value="gps"]');
      }, 'a falha da lista de estados e as ordens por distância no seletor');
      await assentar(page, 100);
      // A função vai SERIALIZADA pra página: ela mede a aba que está na tela.
      const varrer = () => page.evaluate(() => {
        const NOSSOS = ['filterSort', 'filterResidential', 'filterRegion', 'langSelect'];
        const precisa = (sel, txt) => {
          const clone = sel.cloneNode(false);
          clone.removeAttribute('id');
          clone.style.cssText = 'width:auto;min-width:0;max-width:none;position:absolute;visibility:hidden;left:0;top:0';
          const o = document.createElement('option');
          o.textContent = txt;
          clone.appendChild(o);
          sel.parentElement.appendChild(clone);
          const w = clone.getBoundingClientRect().width;
          clone.remove();
          return Math.round(w * 10) / 10;
        };
        const medidas = [];
        for (const sel of document.querySelectorAll('#filtersModal select')) {
          if (!sel.getClientRects().length) continue;   // o seletor da outra aba
          const real = Math.round(sel.getBoundingClientRect().width * 10) / 10;
          for (const o of sel.options) {
            if (!o.hasAttribute('data-i18n') && !NOSSOS.includes(sel.id)) continue;
            medidas.push({ id: sel.id, valor: o.value, i18n: o.getAttribute('data-i18n'), txt: o.text, precisa: precisa(sel, o.text), real });
          }
        }
        const estado = document.getElementById('filterState');
        const real = Math.round(estado.getBoundingClientRect().width * 10) / 10;
        return { medidas, longo: estado.getClientRects().length ? precisa(estado, 'x'.repeat(200)) : null,
          curto: estado.getClientRects().length ? precisa(estado, 'x') : null, real };
      });
      const filtros = await varrer();
      await page.evaluate(() => switchFilterTab('filtersTabPrefs'));
      await assentar(page, 60);
      const prefs = await varrer();
      const medidas = [...filtros.medidas, ...prefs.medidas];
      checa(filtros.longo > filtros.real, `${onde}: CONTROLE — o texto de 200 caracteres "coube": o instrumento não mede`, `${filtros.longo}/${filtros.real}`);
      checa(filtros.curto <= filtros.real, `${onde}: CONTROLE — uma letra "não coube": o instrumento acusa tudo`, `${filtros.curto}/${filtros.real}`);
      // CONTROLE: a varredura mediu as opções que já cortaram (sem elas, "nada
      // corta" não diz nada) e o seletor de idioma, da outra aba.
      for (const [id, valor] of [['filterState', ''], ['filterSort', 'gps'], ['filterResidential', 'true'], ['langSelect', lang]]) {
        checa(medidas.some((m) => m.id === id && m.valor === valor), `${onde}: CONTROLE — a varredura não mediu #${id} [${valor}]`);
      }
      checa(medidas.length >= 15, `${onde}: CONTROLE — só ${medidas.length} opções medidas`);
      for (const m of medidas) {
        checa(m.precisa <= m.real, m.i18n === 'filters.state.naoCarregou'
          ? `${onde}: a falha da lista de estados sai cortada no seletor fechado (R66-3)`
          : `${onde}: opção cortada no seletor fechado #${m.id}`, `"${m.txt}" precisa ${m.precisa} px, o seletor tem ${m.real}`);
      }
      checa(erros.length === 0, `${onde}: erro de JS`, erros[0]);
      await ctx.close();
    }
  }
}

// ── A Ajuda: toda seção no MESMO molde, medido na TELA ─────────────────────
// "Quem está no app" nasceu com a lista em 16px (as vizinhas são 14) e o título
// sem dois-pontos, e ficou assim um mês — quem viu foi o owner, olhando. O
// test/ajuda.test.mjs cobra as CLASSES; aqui se mede o que a tela DEU (o tamanho
// computado), nos 4 idiomas, no aparelho do owner e no mais apertado. A
// contraprova devolve a classe antiga e exige que a medida a enxergue.
{
  const medirAjuda = (page) => page.evaluate(() => {
    const painel = document.querySelector('#helpModal > div');
    return [...painel.querySelectorAll('h4')].map((h) => {
      const corpo = h.nextElementSibling;
      const texto = corpo && /^(UL|OL|P)$/.test(corpo.tagName) ? (corpo.tagName === 'P' ? corpo : corpo.querySelector('li')) : null;
      return {
        chave: h.getAttribute('data-i18n'),
        titulo: h.textContent.trim(),
        caixa: getComputedStyle(h).textTransform === 'uppercase',
        fonte: texto ? getComputedStyle(texto).fontSize : null,
      };
    });
  });
  for (const [ap, viewport] of [['Pixel 7', { width: 412, height: 915 }], ['Galaxy Fold', { width: 280, height: 653 }]]) {
    for (const lang of LINGUAS) {
      const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', locale: lang === 'en' ? 'en-US' : lang });
      const page = await ctx.newPage();
      await page.addInitScript((l) => {
        localStorage.setItem('waze_places_lang', l);
        localStorage.setItem('waze_places_preferences', JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true }));
      }, lang);
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(450);
      await page.click('#helpBtn');   // o ⓘ existe deslogado: é o caminho de quem ainda nem entrou
      await assentar(page, 200);
      const onde = `Ajuda/${ap}/${lang}`;
      const secoes = await medirAjuda(page);
      const corpos = secoes.filter((s) => s.fonte);
      checa(corpos.length >= 7, `${onde}: esperava 7+ seções com lista ou parágrafo`, String(corpos.length));
      const tamanhos = [...new Set(corpos.map((s) => s.fonte))];
      checa(tamanhos.length === 1, `${onde}: o texto das seções sai em tamanhos diferentes`,
        corpos.map((s) => `${s.chave}=${s.fonte}`).join(' '));
      for (const s of secoes) {
        if (s.caixa) checa(!/:\s*$/.test(s.titulo), `${onde}: o título de caixa "${s.titulo}" ganhou dois-pontos`);
        else checa(/:$/.test(s.titulo), `${onde}: o título "${s.titulo}" não termina em dois-pontos, como as vizinhas`);
      }
      const chaves = secoes.map((s) => s.chave);
      checa(chaves.indexOf('help.presenca.title') === chaves.indexOf('help.howToUse.title') + 1,
        `${onde}: "Quem está no app" não está logo depois de "Como usar"`, chaves.join(' → '));
      if (ap === 'Pixel 7' && lang === 'pt') {
        // CONTRAPROVA: a lista com a classe de ANTES tem que aparecer na medida.
        await page.evaluate(() => {
          const ul = document.querySelector('[data-i18n="help.presenca.title"]').nextElementSibling;
          ul.className = 'list-disc list-inside space-y-1 text-slate-600 dark:text-slate-300';
        });
        const sab = [...new Set((await medirAjuda(page)).filter((s) => s.fonte).map((s) => s.fonte))];
        checa(sab.length === 2, `${onde}: a contraprova (a lista de antes, em 16px) não apareceu na medida`, sab.join(' '));
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
    // E fiel a um pedido de FOTO NOVA: o tipo, e o id do pedido na URL da foto
    // proposta (no fragmento) — o `podeAprovarAtual` exige os dois desde a
    // auditoria de 2026-09-25, e sem eles o CONTROLE abaixo nao ve o aprovar.
    const ur = b.updateRequestID || 'ur-pl';
    return { ...b, name: b.name || 'Padaria do Ze', localAprovado: true, purType: 'NEW_PHOTO', updateRequestID: ur,
             imageUrl: foto, imageUrls: [foto + '#' + ur, foto + '#outra1', foto + '#outra2'],
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

// ── Teto da lista de autores: o botão só existe quando SOBRA alguém ────────
// A borda é 10 EXATOS: nada escondido, nenhum botão. Um "Ver mais 0" — ou um
// botão que some sem explicação — é pior que não ter teto. E a altura tem que
// ficar CONSTANTE: é o ganho inteiro do recurso (medido: 2,4 telas com 23
// autores sem teto, 7,1 com 100, 34,9 com 500; com teto, sempre a mesma).
{
  const onde = 'teto de autores';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errosT = [];
  page.on('pageerror', (e) => errosT.push(String(e)));
  await page.addInitScript(() => localStorage.setItem('waze_places_preferences',
    JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true })));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(450);

  const alturas = [];
  for (const n of [0, 9, 10, 11, 23, 100]) {
    const m = await page.evaluate((qtd) => {
      const dia = Math.floor(Date.now() / 86400000);
      const r = {};
      for (let i = 0; i < qtd; i++) r[String(100000 + i)] = [30 - (i % 28), `autor_${i}`, dia - (i % 30)];
      localStorage.setItem('waze_places_autores', JSON.stringify({ v: [], r }));
      AppState.autores = null;
      AppState.profile = { rank: 5, isAreaManager: true, userName: 'x' };
      AppState.authenticated = true;
      openModal('filtersModal'); switchFilterTab('filtersTabHistory'); renderHistory();
      const btn = document.getElementById('autoresVerMais');
      return {
        linhas: document.querySelectorAll('.autor-lin').length,
        rotulo: btn ? (btn.textContent || '').trim() : null,
        alvo: btn ? Math.round(btn.getBoundingClientRect().height) : null,
        largura: btn ? Math.round(btn.getBoundingClientRect().width) : null,
        altura: Math.round(document.getElementById('autoresBody').getBoundingClientRect().height),
      };
    }, n);
    if (n <= 10) {
      checa(m.rotulo === null, `${onde}: ${n} autores geraram botão`, m.rotulo);
      checa(m.linhas === n, `${onde}: ${n} autores mostraram ${m.linhas} linhas`);
    } else {
      checa(m.linhas === 10, `${onde}: ${n} autores mostraram ${m.linhas} linhas (esperado 10)`);
      checa(!!m.rotulo && m.rotulo.includes(String(n - 10)),
        `${onde}: o rótulo não traz quantos faltam`, `${m.rotulo} (esperava conter ${n - 10})`);
      checa(m.alvo >= 44, `${onde}: alvo de ${m.alvo}px < 44`);
      checa(m.largura > 300, `${onde}: botão estreito demais`, `${m.largura}px`);
      alturas.push(m.altura);
    }
  }
  // O ganho: 11, 23 e 100 autores custam a MESMA altura.
  checa(new Set(alturas).size === 1,
    `${onde}: a altura não ficou constante — é o ganho inteiro do teto`, JSON.stringify(alturas));

  // Ida e volta, e a volta ao padrão ao fechar por Esc (não pelo botão).
  const ida = await page.evaluate(async () => {
    document.getElementById('autoresVerMais').click();
    await new Promise((r) => setTimeout(r, 80));
    return { linhas: document.querySelectorAll('.autor-lin').length,
             rotulo: (document.getElementById('autoresVerMais').textContent || '').trim() };
  });
  checa(ida.linhas === 100, `${onde}: tocar não expandiu`, String(ida.linhas));
  checa(ida.rotulo && !/100|90/.test(ida.rotulo),
    `${onde}: expandido continua prometendo "ver mais"`, ida.rotulo);
  await page.keyboard.press('Escape');
  await assentar(page, 200);
  const reab = await page.evaluate(() => {
    openModal('filtersModal'); switchFilterTab('filtersTabHistory'); renderHistory();
    return document.querySelectorAll('.autor-lin').length;
  });
  checa(reab === 10, `${onde}: reabrir depois do Esc não voltou à lista curta`, String(reab));
  checa(errosT.length === 0, `${onde}: erro de JS`, errosT[0]);
  await ctx.close();
}

// ── FAB do modo dev: onde ele NASCE, e se dá pra mover ──────────────────
//
// Os dois defeitos vieram do aparelho do owner, e os dois passariam verde em
// qualquer teste de mouse:
//
//  1. **Tapava o ✕ dos modais.** É o gotcha #26 outra vez (sobreposição só se
//     mede por `elementFromPoint`; os dois retângulos existem e só o hit-test
//     diz quem recebe o dedo). Medido antes do conserto: em 3 de 3 celulares o
//     FAB cobria `closeFilters` e `closeHelp` — e no tablet, nenhum dos dois,
//     que é justamente por que "escolher um canto bom" não resolve.
//  2. **O arrasto morria em ~15px.** `touch-action: auto` faz o navegador
//     reivindicar o gesto como rolagem e mandar `pointercancel`. Medido: dos
//     20 movimentos de dedo despachados chegava UM.
//
// Por isso este bloco roda com TOQUE de verdade (`hasTouch`) e eventos de
// toque por CDP — `mouse.move` nunca teria reproduzido nenhum dos dois.
{
  // Controle acionável MAIS o que o FAB não pode cobrir por ser LEITURA
  // (`.nao-cobrir`, hoje o #placar). Cobrir prosa esconde; cobrir número
  // mente — "311" com a última coluna comida lê como "31".
  const ALVO_PROIBIDO = 'button, a[href], input, select, textarea, label[for], [role="button"], [tabindex]:not([tabindex="-1"]), .nao-cobrir';
  const APARELHOS_FAB = [['iPhone SE', { width: 375, height: 667 }],
                         ['Pixel 7', { width: 412, height: 915 }],
                         ['Galaxy Fold', { width: 280, height: 653 }]];
  // Em que aparelhos o toast de fato cobriu um botão do card (sem isso, "o
  // toast não virou alerta" passaria sem o caso ter existido).
  const toastCobriuBotao = [];
  for (const [nomeAp, vp] of APARELHOS_FAB) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'pt-BR',
      hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errosF = [];
    let baixouF = 0;
    page.on('pageerror', (e) => errosF.push(e.message));
    page.on('download', () => { baixouF++; });
    await page.addInitScript(() => {
      window.__vib = [];
      Object.defineProperty(navigator, 'vibrate',
        { value: (n) => { window.__vib.push(n); return true; }, configurable: true });
    });
    await page.goto(BASE, { waitUntil: 'load' });
    // `assentar` entra por `page.evaluate`, e evaluate durante navegação morre
    // com "Execution context was destroyed" — espera crua primeiro.
    await page.waitForTimeout(600);
    await esperarOuExplodir(page, () => typeof AppState !== 'undefined', 'AppState');
    await assentar(page, 200);
    await page.evaluate((fila) => {
      AppState.devMode = { unlocked: true, active: true };
      AppState.authenticated = true;
      AppState.profile = { id: 1, userName: 'a', rank: 5, isAreaManager: true, isStaff: false };
      AppState.queue = JSON.parse(JSON.stringify(fila));
      AppState.currentPlace = AppState.queue[0];
      AppState.serverTotal = fila.length; AppState.hasMore = false;
      showMainScreen(); updateStats(); showLoading(false);
      document.getElementById('noMoreCards').classList.add('hidden');
      showCurrentPlace();
      atualizarFabDev();
    }, FIXTURES_PAISES.slice(0, 3));
    await assentar(page, 400);

    // ── nasce livre em toda camada ──────────────────────────────────────
    const camadas = [
      ['card', null],
      ['Filtros', 'filtersModal'],
      ['Ajuda', 'helpModal'],
      ['lightbox', '__lightbox'],
      ['de volta ao card', null],
    ];
    for (const [nome, id] of camadas) {
      // Fechar e abrir no MESMO quadro é o gotcha #65: o `closeModal` AGENDA um
      // `history.back()` e o `openModal` seguinte empilha, o back pendente come
      // a entrada nova, e umas voltas depois a aba sai do app — que aqui
      // aparecia como "Execution context was destroyed". Fecha num quadro, abre
      // no outro. E fecha só o que está aberto: `closeModal` de modal fechado
      // sai cedo, mas o do lightbox não tem essa guarda.
      await page.evaluate(() => {
        try { if (Lightbox.isOpen()) Lightbox.close(); } catch (e) {}
        const aberto = MODAL_IDS.find((m) => !document.getElementById(m).classList.contains('hidden'));
        if (aberto) closeModal(aberto);
      });
      await assentar(page, 250);
      await page.evaluate((alvo) => {
        if (alvo === '__lightbox') {
          Lightbox.open(['data:image/gif;base64,R0lGODlhAQABAAAAACw='], 0, -1, 'x', false, AppState.currentPlace);
        } else if (alvo) openModal(alvo);
      }, id);
      await assentar(page, 250);
      await doisQuadros(page);
      const r = await page.evaluate((sel) => {
        const fab = document.getElementById('devFab');
        const btn = document.getElementById('devFabBtn');
        // CONTROLE: a camada tem que estar mesmo na tela, senão a linha mede
        // o card com outro nome e passa verde por engano.
        const lb = document.getElementById('imageLightbox');
        const viva = !lb.classList.contains('hidden') ? 'lightbox'
          : (MODAL_IDS.find((i) => !document.getElementById(i).classList.contains('hidden')) || 'card');
        const b = btn.getBoundingClientRect();
        const pe = fab.style.pointerEvents, peB = btn.style.pointerEvents;
        fab.style.pointerEvents = 'none'; btn.style.pointerEvents = 'none';
        const tapa = new Set();
        // Grade ATÉ A BORDA. Com os cantos recuados a 0,15 sobravam 6,6px cegos
        // de cada lado num quadro de 44px — e o vizinho encosta justamente aí:
        // medido, o FAB invadia 6px do "›" e este laço passava verde.
        const gr = [0.02, 0.5, 0.98], pts = [];
        for (const fx of gr) for (const fy of gr) pts.push([fx, fy]);
        for (const [fx, fy] of pts) {
          const sob = document.elementFromPoint(b.left + b.width * fx, b.top + b.height * fy);
          const a = sob && sob.closest(sel);
          if (a && !fab.contains(a)) tapa.add(a.id || a.getAttribute('aria-label') || a.className.split(' ')[0]);
        }
        fab.style.pointerEvents = pe; btn.style.pointerEvents = peB;
        // e o FAB precisa continuar RECEBENDO o dedo: canto livre com o botão
        // enterrado sob outra camada seria "livre" e inútil.
        const meu = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return { tapa: [...tapa], viva, alcancavel: !!meu && fab.contains(meu),
                 visivel: b.width >= 44 && b.height >= 44 };
      }, ALVO_PROIBIDO);
      const esperada = id === '__lightbox' ? 'lightbox' : (id || 'card');
      checa(r.viva === esperada, `FAB/${nomeAp}: "${nome}" não montou a camada`, r.viva);
      checa(r.tapa.length === 0, `FAB/${nomeAp}: em "${nome}" o botão tapa controle`, r.tapa.join(', '));
      checa(r.alcancavel, `FAB/${nomeAp}: em "${nome}" o próprio FAB não recebe o toque`);
      checa(r.visivel, `FAB/${nomeAp}: em "${nome}" o alvo ficou menor que 44px`);
    }

    // ── PAINÉIS SEM MODAL: a falha de carga e o convite de instalar ─────
    //
    // O observador do canto vigiava modal, lightbox e as duas telas — e os
    // painéis da fila vazia aparecem sem mexer em nenhum deles. O FAB ficava
    // onde estava: na borda do "Tentar de novo" (Fold) e do "Agora não" do
    // convite (iPhone SE), auditoria de 2026-09-26 (D8). O canto em que ele
    // estava antes depende do card, então o caso é MONTADO em todo aparelho:
    // com o painel escondido, o FAB (automático, não fixado) é posto em cima de
    // onde o botão nasce — só a reavaliação o tira de lá.
    //
    // A régua é a do próprio `posicionarFabDev`, medida por fora: ele fica no
    // canto de MENOS vítimas, e não em cima de um botão do painel quando existe
    // canto que não cubra nenhum. MEDIDO no Fold com o convite: NENHUM canto é
    // livre (em cima o placar, embaixo os dois botões do convite, no meio o
    // "Verificar novamente") — e aí o melhor é o placar, não um botão.
    const vitimasPorCanto = () => page.evaluate((sel) => {
      const fab = document.getElementById('devFab'), btn = document.getElementById('devFabBtn');
      const f = btn.getBoundingClientRect(), w = f.width || 44, h = f.height || 44;
      const conta = (x, y) => {
        const v = new Set();
        for (const fx of [0.02, 0.5, 0.98]) for (const fy of [0.02, 0.5, 0.98]) {
          const sob = document.elementFromPoint(x + w * fx, y + h * fy);
          const a = sob && sob.closest(sel);
          if (a && !fab.contains(a)) v.add(a.id || a.className.split(' ')[0]);
        }
        return [...v];
      };
      const pe = fab.style.pointerEvents, peB = btn.style.pointerEvents;
      fab.style.pointerEvents = 'none'; btn.style.pointerEvents = 'none';
      const cantos = {};
      for (const c of DEV_FAB_CANTOS) { const { x, y } = devFabCoords(c, w, h); cantos[c] = conta(x, y); }
      const agora = conta(f.left, f.top);
      fab.style.pointerEvents = pe; btn.style.pointerEvents = peB;
      return { agora, cantos };
    }, ALVO_PROIBIDO);
    await page.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      e.prompt = () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(e);
    });
    for (const [nomeP, chave, botoes] of [['falha de carga', 'falha', ['retryLoadBtn']],
      ['fila vazia com o convite', 'convite', ['reloadBtn', 'installInviteBtn', 'installDismissBtn']]]) {
      const alvo = await page.evaluate((k) => {
        AppState.queue = []; AppState.currentPlace = null; AppState.loadError = k === 'falha';
        // O convite mora no "Tudo limpo!" de quem TERMINOU a fila (R6-7-11).
        tratouNestaFila = true; puladosNoInicioDaFila = AppState.stats.skipped || 0;
        showNoPlaces();
        const b = document.getElementById(k === 'falha' ? 'retryLoadBtn' : 'installDismissBtn');
        const r = b && b.getBoundingClientRect();
        return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      }, chave);
      checa(!!alvo, `FAB/${nomeAp}: PRÉ-CONDIÇÃO — o botão do painel "${nomeP}" não apareceu`);
      if (!alvo) continue;
      await page.evaluate(() => ['loadErrorState', 'noMoreCards', 'installInvite']
        .forEach((id) => document.getElementById(id).classList.add('hidden')));
      await doisQuadros(page);
      await page.evaluate(({ x, y }) => {
        const f = document.getElementById('devFab'); const r = f.getBoundingClientRect();
        f.style.left = (x - r.width / 2) + 'px'; f.style.top = (y - r.height / 2) + 'px';
        f.style.right = 'auto'; f.style.bottom = 'auto';
      }, alvo);
      await page.evaluate(() => showNoPlaces());   // o painel volta pelo caminho do app
      await assentar(page, 200);
      await doisQuadros(page);
      const v = await vitimasPorCanto();
      const noBotao = v.agora.filter((id) => botoes.includes(id));
      const haCantoSemBotao = Object.values(v.cantos).some((l) => !l.some((id) => botoes.includes(id)));
      const minimo = Math.min(...Object.values(v.cantos).map((l) => l.length));
      checa(!(haCantoSemBotao && noBotao.length), `FAB/${nomeAp}: no painel "${nomeP}" o botão ficou por cima de ${noBotao.join(', ')} — o canto não foi reavaliado`,
        JSON.stringify(v));
      checa(v.agora.length <= minimo, `FAB/${nomeAp}: no painel "${nomeP}" o botão não está no canto de menos vítimas`, JSON.stringify(v));
    }
    await page.evaluate((fila) => {
      AppState.loadError = false;
      ['loadErrorState', 'noMoreCards', 'installInvite'].forEach((id) => document.getElementById(id).classList.add('hidden'));
      AppState.queue = JSON.parse(JSON.stringify(fila));
      AppState.currentPlace = AppState.queue[0];
      AppState.serverTotal = fila.length;
      showCurrentPlace();
    }, FIXTURES_PAISES.slice(0, 3));
    await assentar(page, 300);
    await doisQuadros(page);

    // ── O TOAST por cima dos botões não é "toqueInterceptado" ───────────
    //
    // A sentinela acusava ✕ ↑ ✓ sempre que um toast comum (z-70, rodapé)
    // estava sobre eles — o lugar dele nas telas baixas, e ele some em
    // segundos. Toda captura até 4 s depois de um toast trazia três alertas
    // falsos (auditoria de 2026-09-26, D3). CONTROLE: um elemento DE VERDADE
    // por cima do ✕ continua acusando.
    const toastR = await page.evaluate(() => new Promise((ok) => {
      showToast('Já tratado por outro editor 👍', 'info', 8000);
      setTimeout(() => {
        const card = cardDaFrente();
        let cobre = 0;
        for (const s of ['.card-btn-reject', '.card-btn-skip', '.card-btn-read']) {
          const r = card.querySelector(s).getBoundingClientRect();
          const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (el && el.closest('#notifyStack')) cobre++;
        }
        const m = dlogCapturar('manual');
        document.querySelectorAll('#toastContainer > *').forEach((t) => t.remove());
        ok({ cobre, alertas: (m.alertas || []).filter((a) => a.chave === 'toqueInterceptado').map((a) => a.alvo) });
      }, 600);
    }));
    if (toastR.cobre) toastCobriuBotao.push(nomeAp);
    checa(toastR.alertas.length === 0,
      `FAB/${nomeAp}: o toast por cima dos botões virou "toqueInterceptado" — é o lugar dele, e ele some`, JSON.stringify(toastR));
    const tampaR = await page.evaluate(() => {
      const b = cardDaFrente().querySelector('.card-btn-reject').getBoundingClientRect();
      const d = document.createElement('div');
      d.style.cssText = `position:fixed;left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;z-index:90`;
      document.body.appendChild(d);
      const m = dlogCapturar('manual');
      d.remove();
      return (m.alertas || []).filter((a) => a.chave === 'toqueInterceptado').map((a) => a.alvo);
    });
    checa(tampaR.includes('.card-btn-reject'),
      `FAB/${nomeAp}: CONTROLE — um elemento de verdade por cima do ✕ deixou de acusar`, JSON.stringify(tampaR));

    // ── o gesto DO OWNER: pressiona, SEGURA, e só então arrasta ─────────
    //
    // O teste antigo pressionava e já movia — e por isso deu verde num FAB que
    // no aparelho dele não andava. O gesto natural pra pegar um botão
    // flutuante é segurar primeiro (ícone da tela inicial, bolha do Android,
    // AssistiveTouch), e era justamente esse que estava quebrado: segurar
    // disparava OUTRA coisa e o `touch-action: auto` cancelava o ponteiro.
    const antes = await page.evaluate(() => {
      const b = document.getElementById('devFab').getBoundingClientRect();
      const cs = getComputedStyle(document.getElementById('devFabBtn'));
      return { x: b.left, y: b.top, w: b.width, h: b.height,
               ta: cs.touchAction, sel: cs.userSelect || cs.webkitUserSelect,
               calo: getComputedStyle(document.getElementById('devFab')).webkitTouchCallout,
               momentos: dlogMomentos.length };
    });
    checa(antes.ta === 'none',
      `FAB/${nomeAp}: sem touch-action:none o navegador cancela o arrasto`, antes.ta);
    checa(antes.sel === 'none',
      `FAB/${nomeAp}: sem user-select:none segurar no selo começa uma seleção e cancela o toque`, antes.sel);
    checa(!antes.calo || antes.calo === 'none',
      `FAB/${nomeAp}: sem -webkit-touch-callout:none o balão do toque longo rouba o gesto`, antes.calo);

    if (pularForaDoChromium(MOTOR, `FAB/${nomeAp}: o gesto de segurar e arrastar`,
      'toque com arraste só se sintetiza pelo protocolo do Chromium (CDP)')) {
      checa(errosF.length === 0, `FAB/${nomeAp}: erro de JS`, errosF[0]);
      await ctx.close();
      continue;
    }
    const cdp = await ctx.newCDPSession(page);
    const cx = antes.x + antes.w / 2, cy = antes.y + antes.h / 2;
    const destinoX = 16 + antes.w / 2, destinoY = vp.height - 140;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
    await page.waitForTimeout(700);
    // PEGOU? O aviso vive em dois canais de propósito (WCAG 1.4.1): sem ele
    // não há como distinguir "o app agarrou" de "o toque se perdeu", que é a
    // descrição literal que o owner deu — "parece que tem algo segurando".
    const pego = await page.evaluate(() => ({
      classe: document.getElementById('devFab').classList.contains('fab-pego'),
      escala: getComputedStyle(document.getElementById('devFabBtn')).transform,
      vib: window.__vib.length,
    }));
    checa(pego.classe, `FAB/${nomeAp}: segurar não pegou o botão`);
    checa(/matrix\(1\.1/.test(pego.escala),
      `FAB/${nomeAp}: pegou mas não cresceu — o aviso visual não chega`, pego.escala);
    checa(pego.vib === 1, `FAB/${nomeAp}: pegou sem vibrar`, String(pego.vib));

    for (let i = 1; i <= 16; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
        touchPoints: [{ x: cx + (destinoX - cx) * i / 16, y: cy + (destinoY - cy) * i / 16 }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await assentar(page, 400);
    const dep = await page.evaluate(() => {
      const b = document.getElementById('devFab').getBoundingClientRect();
      return { x: b.left, y: b.top, momentos: dlogMomentos.length,
               aindaPego: document.getElementById('devFab').classList.contains('fab-pego'),
               fixado: (() => { try { return !!sessionStorage.getItem('__devFabPos'); } catch (e) { return false; } })() };
    });
    checa(Math.abs(dep.x - (destinoX - antes.w / 2)) <= 2 && Math.abs(dep.y - (destinoY - antes.h / 2)) <= 2,
      `FAB/${nomeAp}: o botão não parou onde o dedo largou`,
      `pediu ${Math.round(destinoX - antes.w / 2)},${Math.round(destinoY - antes.h / 2)} · ficou ${Math.round(dep.x)},${Math.round(dep.y)}`);
    checa(dep.fixado, `FAB/${nomeAp}: arrastar não fixou a posição`);
    checa(!dep.aindaPego, `FAB/${nomeAp}: soltou o dedo e o botão continuou "pego"`);
    // Arrastar não é tocar. Com toque o `pointerup` volta pro BOTÃO (captura
    // implícita) e o ouvinte dele corre ANTES do da window — marcar só no fim
    // registrava um momento que ninguém pediu, e o `atualizarFabDev` desse
    // momento devolvia o botão pro canto automático.
    checa(dep.momentos === antes.momentos,
      `FAB/${nomeAp}: arrastar registrou um momento sem ninguém pedir`,
      `${antes.momentos} → ${dep.momentos}`);
    checa(baixouF === 0,
      `FAB/${nomeAp}: o gesto baixou um arquivo — download no meio do arrasto leva o toque embora`,
      String(baixouF));

    // ── o botão fica SOB o dedo o trajeto inteiro ───────────────────────
    // Parar no lugar certo não prova acompanhar: um botão que teleporta no
    // fim passaria igual. Aqui o centro dele é conferido a cada perna.
    let cxz = dep.x + antes.w / 2, cyz = dep.y + antes.h / 2, pior = 0;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cxz, y: cyz }] });
    await page.waitForTimeout(250);
    for (const [tx, ty] of [[vp.width - 40, 200], [40, vp.height - 200], [vp.width / 2, 140]]) {
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
          touchPoints: [{ x: cxz + (tx - cxz) * i / 8, y: cyz + (ty - cyz) * i / 8 }] });
        await page.waitForTimeout(16);
      }
      cxz = tx; cyz = ty;
      await page.waitForTimeout(40);
      const c = await page.evaluate(() => {
        const b = document.getElementById('devFab').getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      });
      pior = Math.max(pior, Math.hypot(c.x - cxz, c.y - cyz));
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await assentar(page, 300);
    checa(pior <= 3, `FAB/${nomeAp}: o botão se descolou do dedo no trajeto`, `${pior.toFixed(1)}px`);

    // ── toque DEVAGAR continua sendo toque ──────────────────────────────
    // Quem decide toque × arrasto é ter ANDADO, nunca o relógio: com o tempo
    // decidindo, segurar sem querer viraria um beco sem ação nenhuma.
    const antesLento = await page.evaluate(() => dlogMomentos.length);
    const p2 = await page.evaluate(() => {
      const b = document.getElementById('devFab').getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p2.x, y: p2.y }] });
    await page.waitForTimeout(600);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await assentar(page, 300);
    const depoisLento = await page.evaluate(() => dlogMomentos.length);
    checa(depoisLento === antesLento + 1,
      `FAB/${nomeAp}: toque devagar deixou de registrar momento`, `${antesLento} → ${depoisLento}`);
    checa(baixouF === 0, `FAB/${nomeAp}: segurar voltou a baixar arquivo`, String(baixouF));

    // ── fixado, o app não mexe mais ─────────────────────────────────────
    // O #devFab tem transição de 0,16s e a reposição é adiada por rAF: ler o
    // rect no MESMO quadro devolve a posição VELHA. É o gotcha #58 no eixo do
    // TEMPO — medir o que a tela deu, sim, mas DEPOIS de ela ter dado. Aqui
    // isso daria falso POSITIVO: o app poderia estar movendo o botão fixado e
    // a leitura imediata diria que não.
    const antesDoModal = await page.evaluate(() => {
      const b = document.getElementById('devFab').getBoundingClientRect();
      return { x: b.left, y: b.top };
    });
    await page.evaluate(() => openModal('filtersModal'));
    await assentar(page, 400);
    const aindaLa = await page.evaluate(() => {
      const b = document.getElementById('devFab').getBoundingClientRect();
      return { x: b.left, y: b.top };
    });
    await page.evaluate(() => closeModal('filtersModal'));
    await assentar(page, 300);
    checa(Math.abs(aindaLa.x - antesDoModal.x) <= 1 && Math.abs(aindaLa.y - antesDoModal.y) <= 1,
      `FAB/${nomeAp}: fixado pelo editor, mas o app o moveu sozinho`,
      `${Math.round(antesDoModal.x)},${Math.round(antesDoModal.y)} → ${Math.round(aindaLa.x)},${Math.round(aindaLa.y)}`);

    // ── desligar o modo dev devolve o automático ────────────────────────
    const sobrou = await page.evaluate(() => {
      dlogApagar();
      let ficou = true;
      try { ficou = !!sessionStorage.getItem('__devFabPos'); } catch (e) {}
      AppState.devMode.active = true; atualizarFabDev();
      return ficou;
    });
    await assentar(page, 400);
    const zerou = await page.evaluate(() => {
      const b = document.getElementById('devFab').getBoundingClientRect();
      return { sobrou: false, x: b.left, y: b.top };
    });
    zerou.sobrou = sobrou;
    checa(!zerou.sobrou, `FAB/${nomeAp}: desligar o modo dev deixou a posição fixada pra trás`);
    checa(Math.abs(zerou.x - (vp.width - antes.w - 12)) <= 1,
      `FAB/${nomeAp}: depois de apagar não voltou ao canto automático`,
      `${Math.round(zerou.x)} ≠ ${vp.width - antes.w - 12}`);

    // ── DOIS dedos no botão, soltos antes de "pegar" ────────────────────
    // O segundo `pointerdown` sobrescrevia o relógio do primeiro sem cancelá-lo,
    // e o relógio órfão "pegava" o botão SEM dedo nenhum: ele ficava em
    // `fab-pego` pra sempre — crescido, parado, por cima do "Aplicar" dos
    // Filtros, e nem desligar e religar o modo dev o soltava (auditoria de
    // 2026-09-26, D7). O controle é o de cima: segurar UM dedo ainda pega.
    const p7 = await page.evaluate(() => {
      const b = document.getElementById('devFab').getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p7.x, y: p7.y, id: 1 }] });
    await page.waitForTimeout(40);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart',
      touchPoints: [{ x: p7.x, y: p7.y, id: 1 }, { x: p7.x + 6, y: p7.y + 6, id: 2 }] });
    await page.waitForTimeout(40);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p7.x + 6, y: p7.y + 6, id: 2 }] });
    await page.waitForTimeout(40);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(500);
    const doisDedos = await page.evaluate(() => document.getElementById('devFab').classList.contains('fab-pego'));
    checa(!doisDedos, `FAB/${nomeAp}: dois dedos soltos antes de pegar deixaram o botão "pego" sem dedo nenhum`);
    // E o "pego" que sobrar sem dedo (qualquer caminho) não trava o botão: o
    // canto é reavaliado, e apagar o modo dev o solta.
    const preso = await page.evaluate(() => {
      const f = document.getElementById('devFab');
      f.classList.add('fab-pego');
      posicionarFabDev();
      const reposicionou = !f.classList.contains('fab-pego');
      f.classList.add('fab-pego');
      dlogApagar();
      const soltou = !f.classList.contains('fab-pego');
      AppState.devMode.active = true; atualizarFabDev();
      return { reposicionou, soltou };
    });
    checa(preso.reposicionou && preso.soltou,
      `FAB/${nomeAp}: "pego" sem dedo travou o botão (a reavaliação ou o apagar não o soltam)`, JSON.stringify(preso));

    // ── o SELO conta só o que VOCÊ registrou ────────────────────────────
    // Pedido do owner depois de ver o selo ir a 2, 4 e 5 em três toques: ele
    // somava as capturas AUTOMÁTICAS (o arraste do card além do limiar, com
    // cota de 2) às do toque, e o primeiro toque já mostrava 2. Aqui as duas
    // coisas acontecem DE VERDADE — arraste por toque no card, toque no FAB —,
    // e o selo tem que contar só o toque. Com o selo antigo este bloco reproduz
    // o relato exato: o primeiro toque mostra "2".
    //
    // DOIS controles, e os dois já pegaram coisa: o ponto do arraste tem que
    // cair NO card (na primeira versão o "Como funciona" estava por cima e o
    // arraste nunca aconteceu), e a automática tem que ter ENTRADO no anel —
    // sem ela, "o selo não contou a automática" passaria com a automática
    // simplesmente não existindo.
    await page.evaluate(() => {
      try { if (Lightbox.isOpen()) Lightbox.close(); } catch (e) {}
      const aberto = MODAL_IDS.find((m) => !document.getElementById(m).classList.contains('hidden'));
      if (aberto) closeModal(aberto);
    });
    await assentar(page, 300);
    const lerSelo = () => page.evaluate(() => {
      const s = document.getElementById('devFabBadge');
      return { txt: s.textContent.trim(), visivel: !s.classList.contains('hidden'), anel: dlogMomentos.length,
        auto: dlogMomentos.filter((m) => m.motivo === 'auto:arraste').length, naoBaixados: dlogNaoBaixados() };
    });
    const tocarFab = async () => {
      const c = await page.evaluate(() => {
        const b = document.getElementById('devFab').getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
      await page.waitForTimeout(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await assentar(page, 300);
    };
    const pArr = await page.evaluate(() => {
      const n = document.querySelector('#cardStack .place-card:not(.card-fundo) .card-name');
      const r = n.getBoundingClientRect();
      const x = r.left + Math.min(40, r.width / 2), y = r.top + r.height / 2;
      const sob = document.elementFromPoint(x, y);
      return { x, y, noCard: !!(sob && sob.closest('#cardStack .place-card:not(.card-fundo)')),
               pedido: AppState.currentPlace && AppState.currentPlace.updateRequestID };
    });
    checa(pArr.noCard, `FAB/${nomeAp}: CONTROLE — o ponto do arraste não cai no card da frente`, JSON.stringify(pArr));
    // Até 40% da largura (o limiar é 25%) e de volta, DEVAGAR: soltar no lugar
    // e parado não decide nada — só a captura automática acontece.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pArr.x, y: pArr.y }] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
        touchPoints: [{ x: pArr.x + vp.width * 0.4 * i / 10, y: pArr.y }] });
      await page.waitForTimeout(16);
    }
    for (let i = 9; i >= 0; i--) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
        touchPoints: [{ x: pArr.x + vp.width * 0.4 * i / 10, y: pArr.y }] });
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(200);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await assentar(page, 500);
    const s0 = await lerSelo();
    checa(s0.auto === 1 && s0.anel === 1,
      `FAB/${nomeAp}: CONTROLE — o arraste além do limiar não capturou sozinho (a medida do selo não valeria)`,
      JSON.stringify(s0));
    const pedidoDepois = await page.evaluate(() => AppState.currentPlace && AppState.currentPlace.updateRequestID);
    checa(pedidoDepois === pArr.pedido, `FAB/${nomeAp}: o arraste de volta decidiu o pedido`,
      `${pArr.pedido} → ${pedidoDepois}`);
    await tocarFab();
    const s1 = await lerSelo();
    checa(s1.txt === '1' && s1.visivel && s1.anel === 2,
      `FAB/${nomeAp}: o selo contou a captura automática — o primeiro toque tem que mostrar 1`, JSON.stringify(s1));
    await tocarFab();
    const s2 = await lerSelo();
    checa(s2.txt === '2' && s2.anel === 3 && s2.naoBaixados === 2,
      `FAB/${nomeAp}: o segundo toque tem que mostrar 2, e o aviso do desligar contar o mesmo`, JSON.stringify(s2));
    // Baixado é marcado NO momento: o aviso zera, e a captura seguinte conta 1.
    const s3 = await page.evaluate(() => { dlogMarcarBaixados(); return dlogNaoBaixados(); });
    checa(s3 === 0, `FAB/${nomeAp}: baixado, o aviso do desligar ainda conta captura`, String(s3));
    await tocarFab();
    const s4 = await lerSelo();
    checa(s4.txt === '3' && s4.naoBaixados === 1,
      `FAB/${nomeAp}: depois de baixar, o selo segue contando (3) e o aviso só a nova (1)`, JSON.stringify(s4));

    checa(errosF.length === 0, `FAB/${nomeAp}: erro de JS`, errosF[0]);
    await ctx.close();
  }
  // CONTROLE do toast (D3): em algum aparelho ele TEM que ter coberto um botão
  // do card — senão "o toast por cima não acusa" passaria sem o caso existir.
  checa(toastCobriuBotao.length > 0,
    'FAB: CONTROLE — em nenhum aparelho o toast cobriu um botão do card; a medida do D3 não mede nada');
}

// ── O teclado virtual não pode achatar os modais sem teclado ──────────────
//
// Veio do PWA instalado de um editor L2+AM: `--kb-inset` cravado em 388px com
// NADA focado. Ele desconta do teto dos 11 modais e do padding que os
// centraliza, então o de Filtros ficou com 302pt onde deviam ser 690 — medido
// no vídeo dele: 305pt. E como só era recalculado em `resize`/`scroll` do
// visualViewport, que o scroll-lock do modal (`body{overflow:hidden}`) impede
// de disparar, o estrago durava a sessão inteira.
//
// O `visualViewport` aqui é FALSO de propósito: é a única forma de mandar o
// navegador mentir a altura sob demanda. As duas linhas que importam são B (o
// bug) e C (o CONTROLE) — sem C, "inset zero em tudo" leria como conserto
// sendo remoção do recurso.
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'pt-BR',
    hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errosK = [];
  page.on('pageerror', (e) => errosK.push(e.message));
  await page.addInitScript(() => {
    const alvo = new EventTarget();
    window.__vvh = 812;
    for (const [k, v] of [['height', () => window.__vvh], ['offsetTop', () => 0],
                          ['width', () => 375], ['scale', () => 1]]) {
      Object.defineProperty(alvo, k, { get: v });
    }
    Object.defineProperty(window, 'visualViewport', { get: () => alvo, configurable: true });
    window.__cobrir = (px) => { window.__vvh = 812 - px; alvo.dispatchEvent(new Event('resize')); };
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await esperarOuExplodir(page, () => typeof AppState !== 'undefined', 'AppState');
  await page.evaluate(() => {
    document.getElementById('authScreen')?.classList.add('hidden');
    document.getElementById('appScreen')?.classList.remove('hidden');
    // O esqueleto de carregamento TEM que sair antes de qualquer `assentar`: o
    // `shimmer` dele é `infinite`, e `assentar` espera o `finished` de TODAS as
    // animações. Com ele na tela o helper nunca resolve — pendura o bloco e, no
    // CI, o job inteiro. Os outros blocos escapam por acidente, porque já
    // renderizaram um card quando chamam o helper.
    document.getElementById('loadingCard')?.classList.add('hidden');
  });

  const kb = () => page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kb-inset')) || 0);
  const alturaDe = (id) => page.evaluate((i) =>
    Math.round(document.querySelector('#' + i + ' > div').getBoundingClientRect().height), id);
  const caixaDe = (id) => page.evaluate((i) => {
    const r = document.querySelector('#' + i + ' > div').getBoundingClientRect();
    return { alt: Math.round(r.height), centro: Math.round((r.top + r.bottom) / 2) };
  }, id);

  // A. sem nada acontecendo: o modal ocupa os 85dvh cheios
  await page.evaluate(() => openModal('filtersModal'));
  await assentar(page, 80);
  const insetA = await kb();
  const altA = await alturaDe('filtersModal');
  checa(insetA === 0, 'teclado: --kb-inset nasce diferente de zero', `${insetA}px`);
  checa(altA > 600, 'teclado: o modal já abre achatado sem teclado nenhum', `${altA}pt`);

  // B. o BUG: viewport mente 388px cobertos, sem campo nenhum focado
  await page.evaluate(() => window.__cobrir(388));
  await assentar(page, 120);
  const insetB = await kb();
  const altB = await alturaDe('filtersModal');
  checa(insetB === 0,
    'teclado: viewport mentiu com NADA focado e virou inset — os modais achatam',
    `${insetB}px`);
  checa(altB === altA,
    'teclado: o modal encolheu sem teclado (o bug do PWA do iOS)', `${altA} → ${altB}pt`);

  // C. CONTROLE: com um campo de texto focado o inset TEM que valer, senão o
  //    campo volta pra trás do teclado — que é o defeito que ele resolvia.
  //    `openModal` sozinho: ele já esconde o anterior, e fechar+abrir no mesmo
  //    quadro dessincroniza o voltar (gotcha #65).
  await page.evaluate(() => { window.__cobrir(0); openModal('pairEnterModal'); });
  await assentar(page, 80);
  const antesC = await caixaDe('pairEnterModal');
  await page.evaluate(() => document.querySelector('#pairEnterModal input[type=text]').focus());
  await page.evaluate(() => window.__cobrir(336));
  await assentar(page, 120);
  const insetC = await kb();
  const depoisC = await caixaDe('pairEnterModal');
  checa(insetC === 336,
    'teclado: campo de texto focado e o inset NÃO valeu — o campo fica atrás do teclado',
    `${insetC}px`);
  // O que se mede é a POSIÇÃO, não a altura: este modal é mais baixo que o teto
  // mesmo com o teclado aberto, então a altura não muda e uma asserção sobre ela
  // reprovaria com o código CERTO. Quem sobe o modal é o
  // `pb-[calc(1rem+var(--kb-inset))]`, e ele move o centro em exatamente kb/2.
  checa(depoisC.centro === antesC.centro - 336 / 2,
    'teclado: o modal não subiu na medida do teclado — o campo fica atrás dele',
    `centro ${antesC.centro} → ${depoisC.centro}pt`);

  // D. e ele SAI quando o campo perde o foco — sem isto o valor fica preso
  //    igual, só que uma etapa depois.
  await page.evaluate(() => document.activeElement.blur());
  await assentar(page, 120);
  const insetD = await kb();
  checa(insetD === 0, 'teclado: o inset ficou preso depois de o campo perder o foco',
    `${insetD}px`);

  checa(errosK.length === 0, 'teclado: erro de JS no caminho do inset', errosK[0]);
  await ctx.close();
}

// ── Resumo do mês: a imagem nasce no aparelho, no tamanho prometido ──────
//
// O teste de núcleo (test/resumo.test.mjs) fatia a LEITURA do mês; o que só o
// browser responde é o resto: o canvas de verdade com a fonte carregada, o QR
// desenhado, o object URL na <img>, os dois botões NA TELA sem rolar (a imagem
// tem teto de altura justamente pra isso), o download com o nome prometido e a
// limpeza ao fechar por Esc — o caminho que NÃO passa pelo botão. Dois
// aparelhos (o do owner e o mais apertado) × 4 idiomas, porque é a string mais
// larga que decide se o botão e os rótulos cabem (gotcha #25).
{
  const onde = 'resumo do mês';
  const APARELHOS_RESUMO = [['Pixel 7', { width: 412, height: 915 }], ['Galaxy Fold', { width: 280, height: 653 }]];
  for (const [nomeAp, vp] of APARELHOS_RESUMO) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'pt-BR', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errosR = [];
    page.on('pageerror', (e) => errosR.push(String(e)));
    await page.addInitScript(() => {
      localStorage.setItem('waze_places_preferences', JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true }));
      // Um mês com forma: dois dias ativos, o de hoje claramente o mais forte.
      // Só dias que JÁ existem (o 1º e o de hoje), pra não depender da data em
      // que o CI roda — e somando, porque no dia 1 os dois são o mesmo balde.
      const d = new Date(), p = (n) => String(n).padStart(2, '0');
      const k = (dia) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(dia)}`;
      const h = { _total: { read: 50, rejected: 35 } };
      const soma = (dia, r, j) => { const kk = k(dia); h[kk] = h[kk] || { read: 0, rejected: 0 }; h[kk].read += r; h[kk].rejected += j; };
      soma(1, 10, 5); soma(d.getDate(), 40, 30);
      localStorage.setItem('waze_places_history', JSON.stringify(h));
    });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await esperarOuExplodir(page, () => typeof AppState !== 'undefined', 'AppState');
    await assentar(page, 200);

    for (const lang of LINGUAS) {
      const m = await page.evaluate(async (lg) => {
        aplicarIdioma(lg);
        // O toast "Idioma alterado" é do TESTE (ninguém troca de idioma com o
        // Resumo aberto) e, no rodapé, cobriria o Baixar na hora de medir o dedo.
        document.querySelectorAll('#toastContainer > *').forEach((el) => el.remove());
        AppState.authenticated = true;
        AppState.profile = { id: 1, userName: 'wazer', rank: 5, isAreaManager: true, isStaff: false };
        AppState.history = null;   // relê o localStorage semeado
        openModal('filtersModal'); switchFilterTab('filtersTabHistory'); renderHistory();
        const btn = document.getElementById('resumoBotao');
        if (!btn) return { botao: false };
        const rb = btn.getBoundingClientRect();
        const out = { botao: true, botaoAlto: Math.round(rb.height), botaoLargo: Math.round(rb.width),
                      largura: innerWidth, botaoTexto: (btn.textContent || '').trim() };
        // Pelo BOTÃO, como a pessoa faz — e espera a imagem chegar na <img>.
        btn.click();
        const img = document.getElementById('resumoImg');
        for (let i = 0; i < 200 && !(img.complete && img.naturalWidth > 0); i++) await new Promise((r) => setTimeout(r, 25));
        out.modalAberto = !document.getElementById('resumoModal').classList.contains('hidden');
        out.filtrosFechado = document.getElementById('filtersModal').classList.contains('hidden');
        out.natural = [img.naturalWidth, img.naturalHeight];
        out.blob = (img.src || '').startsWith('blob:');
        out.titulo = (document.getElementById('resumoTitle').textContent || '').trim();
        // Os botões inteiros na tela, e quem recebe o dedo é o botão (gotcha #26).
        const alvo = (id) => {
          const el = document.getElementById(id), r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { alto: Math.round(r.height), dentro: r.top >= 0 && r.bottom <= innerHeight,
                   hit: !!hit && (hit === el || el.contains(hit)), escondido: el.classList.contains('hidden') };
        };
        out.baixar = alvo('resumoBaixar');
        out.compartilhar = alvo('resumoCompartilhar');
        out.fechar = alvo('resumoClose');
        let podeCompartilhar = false;
        try { podeCompartilhar = !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })); } catch (e) {}
        out.compartilharEsperado = podeCompartilhar;
        // A imagem tem conteúdo ONDE tem que ter: o número branco em cima, o QR
        // embaixo à direita, e o canto é fundo escuro. Blank passaria em tamanho.
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const claros = (x, y, w, h) => {
          const px = g.getImageData(x, y, w, h).data; let n = 0;
          for (let i = 0; i < px.length; i += 4) if (px[i] > 200 && px[i + 1] > 200 && px[i + 2] > 200) n++;
          return n;
        };
        out.pixNumero = claros(80, 240, 400, 150);
        out.pixQr = claros(880, 1150, 120, 120);
        out.pixCanto = claros(0, 0, 40, 40);
        return out;
      }, lang);
      const id = `${onde} ${nomeAp}/${lang}`;
      checa(m.botao, `${id}: o botão do Resumo não apareceu com mês cheio`);
      if (!m.botao) continue;
      checa(m.botaoAlto >= 44, `${id}: botão do Resumo com ${m.botaoAlto}px < 44`);
      checa(m.botaoLargo <= m.largura, `${id}: botão do Resumo mais largo que a tela`, `${m.botaoLargo} > ${m.largura}`);
      checa(!/[{}]/.test(m.botaoTexto) && !/[{}]/.test(m.titulo), `${id}: {mes} vazou cru`, m.botaoTexto + ' / ' + m.titulo);
      checa(m.modalAberto && m.filtrosFechado, `${id}: o Resumo não abriu por cima dos Filtros`);
      checa(m.natural[0] === 1080 && m.natural[1] === 1350, `${id}: imagem de ${m.natural.join('×')} (esperado 1080×1350)`);
      checa(m.blob, `${id}: a <img> não recebeu object URL`);
      for (const [nome, a] of [['Baixar', m.baixar], ['✕', m.fechar]]) {
        checa(a.alto >= 44, `${id}: ${nome} com ${a.alto}px < 44`);
        checa(a.dentro, `${id}: ${nome} fora da tela — a imagem empurrou os botões pra baixo da dobra`);
        checa(a.hit, `${id}: ${nome} não recebe o dedo — algo o cobre`);
      }
      checa(m.compartilhar.escondido === !m.compartilharEsperado,
        `${id}: Compartilhar ${m.compartilhar.escondido ? 'escondido' : 'visível'} num aparelho que ${m.compartilharEsperado ? 'compartilha' : 'NÃO compartilha'} arquivo`);
      if (!m.compartilhar.escondido) {
        checa(m.compartilhar.alto >= 44 && m.compartilhar.dentro && m.compartilhar.hit, `${id}: Compartilhar fora do alvo/tela`);
      }
      checa(m.pixNumero > 500, `${id}: o número grande não foi desenhado`, `${m.pixNumero} px claros`);
      checa(m.pixQr > 1000, `${id}: o QR não foi desenhado`, `${m.pixQr} px claros`);
      checa(m.pixCanto === 0, `${id}: o fundo não é escuro`, `${m.pixCanto} px claros no canto`);

      // Baixar: UM download, com o nome prometido (wazeplaces-AAAA-MM.png).
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
        page.click('#resumoBaixar'),
      ]);
      checa(!!dl, `${id}: Baixar não gerou download`);
      if (dl) checa(/^wazeplaces-\d{4}-\d{2}\.png$/.test(dl.suggestedFilename()), `${id}: nome do arquivo`, dl.suggestedFilename());

      // Fechar por Esc — o caminho que não passa pelo botão — solta o blob e o
      // object URL. É o que LIMPEZA_AO_FECHAR promete.
      await page.keyboard.press('Escape');
      await assentar(page, 250);
      const limpo = await page.evaluate(() => ({
        fechado: document.getElementById('resumoModal').classList.contains('hidden'),
        src: document.getElementById('resumoImg').getAttribute('src'),
        atual: typeof resumoAtual === 'undefined' ? 'indefinido' : resumoAtual,
      }));
      checa(limpo.fechado, `${id}: Esc não fechou o Resumo`);
      checa(limpo.src === null, `${id}: a <img> ficou com o object URL depois de fechar`, String(limpo.src));
      checa(limpo.atual === null, `${id}: resumoAtual não foi solto ao fechar`, String(limpo.atual));
    }
    checa(errosR.length === 0, `${onde} ${nomeAp}: erro de JS`, errosR[0]);
    await ctx.close();
  }
}

// ── Foto de perfil: quando ela falha, some — nunca vira ícone de quebrado ──
//
// O caso real (v2026.09.14-01): o Waze trocou o host da foto e a CSP bloqueou a
// nova URL ANTES da rede. O <img> sem tratamento desenhou o ícone de imagem
// quebrada dentro do círculo do cabeçalho, em toda tela do app, e só o owner
// viu — nenhum teste olhava pra isso.
//
// Aqui os QUATRO caminhos são exercitados com a CSP de verdade do app:
// host fora da CSP (o defeito original, bloqueado antes da rede), 404 de mesma
// origem, o CONTROLE (imagem boa TEM que aparecer — sem ele "esconder sempre"
// passaria) e a troca de idioma depois da falha, que é onde o ícone voltava.
{
  const onde = 'foto de perfil';
  for (const [nomeAp, vp] of [['Pixel 7', { width: 412, height: 915 }], ['Galaxy Fold', { width: 280, height: 653 }]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'pt-BR', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errosA = [];
    page.on('pageerror', (e) => errosA.push(String(e)));
    await page.addInitScript(() => localStorage.setItem('waze_places_preferences',
      JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true })));
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await esperarOuExplodir(page, () => typeof AppState !== 'undefined', 'AppState');
    await assentar(page, 200);

    const cenario = async (url) => page.evaluate(async (u) => {
      AppState.authenticated = true;
      AppState.profile = { id: 1, userName: 'wazer', rank: 5, isAreaManager: true, isStaff: false,
                           profileImageUrl: u, areas: [], managedAreas: [] };
      renderProfileHeader();
      marcarTelaPronta();          // o app só busca a foto depois do 1º card
      const el = document.getElementById('userAvatar');
      // Espera a imagem ASSENTAR: carregou, falhou, ou foi escondida.
      for (let i = 0; i < 120; i++) {
        if (getComputedStyle(el).display === 'none' || (el.complete && el.naturalWidth > 0)) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      await new Promise((r) => setTimeout(r, 60));
      const r = el.getBoundingClientRect();
      return {
        display: getComputedStyle(el).display,
        natural: el.naturalWidth,
        completa: el.complete,
        // O ícone de quebrado só existe se o elemento estiver PINTANDO e sem
        // bitmap: é exatamente esta combinação que o owner viu no iPhone.
        quebrada: getComputedStyle(el).display !== 'none' && el.complete && el.naturalWidth === 0,
        larguraNaTela: Math.round(r.width),
      };
    }, url);

    // 1. O DEFEITO ORIGINAL: host que a CSP não libera (bloqueia antes da rede).
    const bloqueado = await cenario('https://host-fora-da-csp.invalido/foto.png');
    checa(!bloqueado.quebrada, `${onde} ${nomeAp}: host fora da CSP virou ícone de imagem quebrada no cabeçalho`);
    checa(bloqueado.display === 'none', `${onde} ${nomeAp}: avatar bloqueado continua ocupando a tela`, bloqueado.display);

    // 2. Continua escondido depois de REDESENHAR (trocar idioma redesenha o
    //    cabeçalho — era aqui que o ícone voltava).
    const depoisDoIdioma = await page.evaluate(async () => {
      aplicarIdioma('en'); aplicarIdioma('pt');
      document.querySelectorAll('#toastContainer > *').forEach((el) => el.remove());
      await new Promise((r) => setTimeout(r, 120));
      const el = document.getElementById('userAvatar');
      return { display: getComputedStyle(el).display,
               quebrada: getComputedStyle(el).display !== 'none' && el.complete && el.naturalWidth === 0 };
    });
    checa(!depoisDoIdioma.quebrada && depoisDoIdioma.display === 'none',
      `${onde} ${nomeAp}: o avatar morto voltou ao trocar de idioma`, depoisDoIdioma.display);

    // 3. 404 de mesma origem (host no ar, foto que não existe).
    const perdida = await cenario('/nao-existe-esta-foto.png');
    checa(!perdida.quebrada && perdida.display === 'none',
      `${onde} ${nomeAp}: 404 virou ícone de quebrado`, JSON.stringify(perdida));

    // 4. CONTROLE — foto BOA tem que aparecer. Sem isto, "esconder sempre"
    //    passaria neste bloco inteiro e o app ficaria sem avatar nenhum.
    const boa = await cenario('/icons/icon-192.svg');
    checa(boa.display !== 'none' && boa.natural > 0,
      `${onde} ${nomeAp}: CONTROLE falhou — a foto BOA não apareceu`, JSON.stringify(boa));
    checa(boa.larguraNaTela >= 24 && boa.larguraNaTela <= 40,
      `${onde} ${nomeAp}: avatar bom com largura fora do esperado`, `${boa.larguraNaTela}px`);

    checa(errosA.length === 0, `${onde} ${nomeAp}: erro de JS`, errosA[0]);
    await ctx.close();
  }
}

// ── Perto de mim: as três ordens por distância, no filtro ────────────────
//
// O que só o navegador responde aqui é a PERMISSÃO: `getCurrentPosition` é API
// do browser, e conceder/negar muda o caminho inteiro. O Playwright controla
// isso de verdade (grantPermissions/clearPermissions), então os dois desfechos
// são exercitados — inclusive o negado, que é o que a pessoa vê quando já
// recusou uma vez e o navegador não pergunta mais.
//
// E a ORDEM das coordenadas é medida ponta a ponta: a fila entra embaralhada e
// tem que sair do mais perto pro mais longe. Ler [lat,lon] como [lon,lat] não
// quebra nada — só ordena errado (medido no Waze real: 374 pedidos "a ~4.000 km").
{
  const onde = 'perto de mim';
  // São Paulo como referência; os alvos ficam a ~1 km, ~360 km e ~2.130 km.
  const REF = { lat: -23.55, lon: -46.63 };
  const FILA = [
    { id: 'recife', ll: [-8.05, -34.88] },
    { id: 'vizinho', ll: [-23.56, -46.64] },
    { id: 'rio', ll: [-22.91, -43.17] },
  ];
  for (const [nomeAp, vp] of [['Pixel 7', { width: 412, height: 915 }], ['Galaxy Fold', { width: 280, height: 653 }]]) {
    for (const lang of ['pt', 'fr']) {
      const ctx = await browser.newContext({ viewport: vp, locale: 'pt-BR', serviceWorkers: 'block' });
      const page = await ctx.newPage();
      const errosG = [];
      page.on('pageerror', (e) => errosG.push(String(e)));
      await page.addInitScript(() => localStorage.setItem('waze_places_preferences',
        JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true })));
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForTimeout(600);
      await esperarOuExplodir(page, () => typeof AppState !== 'undefined', 'AppState');
      const id = `${onde} ${nomeAp}/${lang}`;

      const abrir = (refs) => page.evaluate(({ lg, refs: r, fila }) => {
        aplicarIdioma(lg);
        document.querySelectorAll('#toastContainer > *').forEach((el) => el.remove());
        AppState.authenticated = true;
        AppState.profile = { id: 1, userName: 'wazer', rank: 5, isAreaManager: true, isStaff: false, areas: [], managedAreas: [] };
        AppState.countries = [{ id: 30, name: 'Brazil' }];
        // A fila inteira já está aqui: o "Aplicar" de uma ordem por distância
        // só reordena (sem ir buscar o resto das páginas, que este bloco não tem).
        AppState.hasMore = false;
        // Caminho REAL: é assim que a resposta do /api/perfil chega.
        guardarReferencias({ referencias: r });
        AppState.queue = fila.map((f) => ({ venueID: f.id, updateRequestID: f.id, mapa: { centro: f.ll }, dateAdded: 1 }));
        // Porta de entrada REAL: é `openFiltersModal` que popula as ordens.
        // Chamar `openModal` direto pularia justamente a ligação que se quer provar.
        openFiltersModal(); switchFilterTab('filtersTabFilters');
        const sel = document.getElementById('filterSort');
        sel.scrollIntoView({ block: 'center' });
        return [...sel.options].map((o) => o.value);
      }, { lg: lang, refs, fila: FILA });

      // 1. COM casa e trabalho no perfil: as três opções existem.
      const comRefs = await abrir({ casa: [REF.lat, REF.lon], trabalho: [REF.lat + 0.02, REF.lon + 0.02] });
      for (const dever of ['newest', 'oldest', 'casa', 'trabalho', 'gps']) {
        checa(comRefs.includes(dever), `${id}: falta a opção "${dever}" no Ordenar por`, comRefs.join(','));
      }

      // 2. A ORDEM sai do mais perto pro mais longe (ponta a ponta).
      const ordenada = await page.evaluate(() => {
        AppState.filters.sortOrder = 'casa';
        sortQueue();
        return AppState.queue.map((p) => p.venueID);
      });
      checa(ordenada.join(',') === 'vizinho,rio,recife',
        `${id}: ordem por distância errada (coordenada invertida?)`, ordenada.join(','));

      // 3. Layout e a dica. A dica só existe quando uma ordem por DISTÂNCIA está
      //    escolhida — em "Mais recentes" não há o que explicar, e linha fixa
      //    num modal que já é longo é ruído. Então escolhe primeiro, pelo
      //    caminho real (o `change` do select).
      const m = await page.evaluate(async () => {
        const sel = document.getElementById('filterSort'), dica = document.getElementById('filterSortHint');
        sel.value = 'casa';
        await aoTrocarOrdenacao();
        const rs = sel.getBoundingClientRect(), rd = dica.getBoundingClientRect();
        const hit = document.elementFromPoint(rs.left + rs.width / 2, rs.top + rs.height / 2);
        return { alvo: Math.round(rs.height), cabe: rs.right <= innerWidth && rd.right <= innerWidth,
                 recebeToque: !!hit && (hit === sel || sel.contains(hit)),
                 dicaVisivel: !dica.classList.contains('hidden'), dicaTxt: (dica.textContent || '').trim() };
      });
      checa(m.alvo >= 44, `${id}: select com ${m.alvo}px < 44`);
      checa(m.cabe, `${id}: o select ou a dica estouram a largura da tela`);
      checa(m.recebeToque, `${id}: algo cobre o select de ordenação`);
      checa(m.dicaVisivel && m.dicaTxt.length > 10, `${id}: a dica de "vem do perfil" não apareceu`, m.dicaTxt);
      checa(!/[{}]/.test(m.dicaTxt), `${id}: placeholder cru vazou na dica`, m.dicaTxt);

      // 4. GPS NEGADO vem ANTES do concedido de propósito: aqui a permissão
      //    ainda não foi dada, que é o estado real de quem nunca concedeu ou já
      //    recusou (aí o navegador nem pergunta de novo). Testar o negado DEPOIS
      //    do concedido mediria outra coisa — o `maximumAge` de 5 min deixa o
      //    navegador servir a posição do cache, e o teste passaria por engano.
      const neg = await page.evaluate(async () => {
        const sel = document.getElementById('filterSort');
        sel.value = 'gps';
        await aoTrocarOrdenacao();
        const dica = document.getElementById('filterSortHint');
        return { valor: sel.value, dica: (dica.textContent || '').trim(),
                 negado: t('filters.sort.hint.negado', { padrao: t('filters.sort.newest') }) };
      });
      checa(neg.valor === 'newest', `${id}: negado deixou "Perto de mim" selecionado sem posição`, neg.valor);
      checa(neg.dica.length > 20 && !/[{}]/.test(neg.dica), `${id}: negado não explicou`, neg.dica);
      // O código 1 de VERDADE, do navegador: é a dica que manda liberar a
      // permissão — a de "sem posição" é pros códigos 2 e 3 (F4, 2026-09-29).
      checa(neg.dica === neg.negado, `${id}: o negado de verdade (código 1) não disse que é a permissão`, neg.dica);

      // 5. GPS CONCEDIDO: fica em 'gps', ordena e a dica confirma.
      //    Numa página RECARREGADA, e o motivo é do WebKit: lá o negado do passo 4
      //    vale pra página inteira. MEDIDO: conceder depois dele e pedir de novo
      //    NA MESMA página devolve "User denied Geolocation"; recarregada, a
      //    posição chega. É o Safari de verdade (quem negou e depois liberou
      //    precisa recarregar). No Chromium o concedido vale na hora, e
      //    recarregar não muda o que este passo mede.
      await ctx.grantPermissions(['geolocation'], { origin: BASE.replace(/\/$/, '') });
      await ctx.setGeolocation({ latitude: REF.lat, longitude: REF.lon, accuracy: 800 });
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(600);
      await esperarOuExplodir(page, () => typeof AppState !== 'undefined', 'AppState');
      await abrir({ casa: [REF.lat, REF.lon], trabalho: [REF.lat + 0.02, REF.lon + 0.02] });
      // Pelo "Aplicar" de VERDADE (auditoria de 2026-09-29): o botão ESPERA a
      // posição (F1) — lido logo depois do pedido sair, antes de ela chegar —, e
      // a posição pedida no modal só vira a da fila no "Aplicar" (F5).
      const ok = await page.evaluate(async () => {
        const sel = document.getElementById('filterSort'), aplicar = document.getElementById('applyFilters');
        sel.value = 'gps';
        const pedido = aoTrocarOrdenacao();
        const esperando = aplicar.disabled;
        await pedido;
        const dica = document.getElementById('filterSortHint');
        const r = { valor: sel.value, dica: (dica.textContent || '').trim(), esperando, depois: aplicar.disabled,
                    daFilaAntesDoAplicar: !!posicaoGps };
        applyFiltersFromModal();
        return { ...r, aplicada: AppState.filters.sortOrder, ordem: AppState.queue.map((p) => p.venueID).join(',') };
      });
      checa(ok.valor === 'gps', `${id}: com permissão concedida a ordem não ficou em GPS`, ok.valor);
      checa(ok.esperando === true, `${id}: o "Aplicar" seguiu vivo com o GPS respondendo — tocado ali, grava "Mais recentes" (F1)`);
      checa(ok.depois === false, `${id}: a posição chegou e o "Aplicar" ficou morto`);
      checa(ok.daFilaAntesDoAplicar === false, `${id}: a posição pedida no modal virou a da fila antes do "Aplicar" (F5)`);
      checa(ok.aplicada === 'gps', `${id}: o "Aplicar" não gravou "Perto de mim"`, ok.aplicada);
      checa(ok.ordem === 'vizinho,rio,recife', `${id}: GPS não ordenou por distância`, ok.ordem);
      checa(!/[{}]/.test(ok.dica) && ok.dica.length > 10, `${id}: dica do GPS concedido`, ok.dica);

      // 5b. A frase de "sem posição" (F4: permissão concedida, posição que não
      //     vem) nos 4 idiomas, NA MESMA dica: cabe na largura, não rola de
      //     lado, não é a do negado e não vaza placeholder. O caminho de verdade
      //     que a acende (o código 3 do Chromium) está logo depois deste laço.
      const semPos = await page.evaluate(({ linguas, volta }) => {
        const out = [];
        openFiltersModal(); switchFilterTab('filtersTabFilters');
        for (const l of linguas) {
          aplicarIdioma(l);
          document.querySelectorAll('#toastContainer > *').forEach((el) => el.remove());
          atualizarDicaDeOrdem('semPosicao');
          const d = document.getElementById('filterSortHint');
          d.scrollIntoView({ block: 'center' });
          const r = d.getBoundingClientRect();
          out.push({ l, txt: (d.textContent || '').trim(), visivel: !d.classList.contains('hidden') && r.height > 0,
                     cabe: r.left >= 0 && r.right <= innerWidth, rolaDeLado: d.scrollWidth > d.clientWidth + 1,
                     negado: t('filters.sort.hint.negado', { padrao: t('filters.sort.newest') }) });
        }
        aplicarIdioma(volta);
        document.querySelectorAll('#toastContainer > *').forEach((el) => el.remove());
        closeModal('filtersModal');
        return out;
      }, { linguas: LINGUAS, volta: lang });
      for (const s of semPos) {
        checa(s.visivel && s.cabe && !s.rolaDeLado, `${id}: a dica de "sem posição" em ${s.l} não cabe na tela`, JSON.stringify(s));
        checa(s.txt !== s.negado && s.txt.length > 30, `${id}: a dica de "sem posição" em ${s.l} é a do negado`, s.txt);
        checa(!/[{}]/.test(s.txt), `${id}: placeholder cru vazou na dica de "sem posição" (${s.l})`, s.txt);
      }

      // 5c. Trocar o IDIOMA nas Preferências com os Filtros abertos (F6): as
      //     opções de texto dos seletores e a dica da ordem mudam JUNTO, sem
      //     fechar e reabrir. Cada opção é lida contra a chave dela no idioma
      //     novo, e o CONTROLE é o texto ter MUDADO (senão "igual ao dicionário"
      //     passaria também sem troca nenhuma).
      const outro = lang === 'pt' ? 'fr' : 'pt';
      const troca = await page.evaluate(async (para) => {
        openFiltersModal(); switchFilterTab('filtersTabFilters');
        const sel = document.getElementById('filterSort');
        sel.value = 'casa';
        await aoTrocarOrdenacao();
        const ler = () => {
          const opcoes = ['filterCategory', 'filterState', 'filterManagedArea'].map((idSel) => {
            const o = document.querySelector(`#${idSel} option[value=""]`);
            return { idSel, txt: o && o.textContent, chave: o && o.getAttribute('data-i18n') };
          });
          return { opcoes, dica: (document.getElementById('filterSortHint').textContent || '').trim() };
        };
        const antes = ler();
        switchFilterTab('filtersTabPrefs');
        const ls = document.getElementById('langSelect');
        ls.value = para;
        ls.dispatchEvent(new Event('change'));
        switchFilterTab('filtersTabFilters');
        const depois = ler();
        const esperado = { opcoes: depois.opcoes.map((o) => o.chave && t(o.chave)), dica: t('filters.sort.hint.perfil') };
        document.querySelectorAll('#toastContainer > *').forEach((el) => el.remove());
        closeModal('filtersModal');
        return { antes, depois, esperado };
      }, outro);
      troca.depois.opcoes.forEach((o, i) => {
        checa(!!o.chave, `${id}: a 1ª opção de #${o.idSel} não tem data-i18n — a troca de idioma não a alcança (F6)`, o.txt);
        checa(o.txt === troca.esperado.opcoes[i] && o.txt !== troca.antes.opcoes[i].txt,
          `${id}: trocou pra ${outro} com os Filtros abertos e #${o.idSel} seguiu em ${lang} (F6)`, `${troca.antes.opcoes[i].txt} → ${o.txt}`);
      });
      checa(troca.depois.dica === troca.esperado.dica && troca.depois.dica !== troca.antes.dica,
        `${id}: trocou pra ${outro} com os Filtros abertos e a dica da ordem seguiu em ${lang} (F6)`, troca.depois.dica);
      await page.evaluate((lg) => { aplicarIdioma(lg); document.querySelectorAll('#toastContainer > *').forEach((el) => el.remove()); }, lang);

      // 5d. Os Filtros abertos ANTES do perfil (o atalho do PWA os abre sempre
      //     assim; F2): a ordem e a área SALVAS ficam na tela — a área dizendo
      //     que carrega —, e o perfil que chega pela porta de verdade
      //     (`definirPerfil`) os redesenha, com o nome da área.
      const semPerfil = await page.evaluate((refs) => {
        AppState.profile = null;
        guardarReferencias(null);
        AppState.filters.sortOrder = 'casa';
        AppState.filters.managedAreaId = '9001';
        openFiltersModal(); switchFilterTab('filtersTabFilters');
        const area = document.getElementById('filterManagedArea'), sel = document.getElementById('filterSort');
        const ler = () => ({ ordem: sel.value, area: area.value, areaTxt: area.selectedOptions[0] && area.selectedOptions[0].textContent });
        const antes = { ...ler(), carregando: t('filters.carregando') };
        definirPerfil({ success: true, referencias: refs, profile: { id: 1, userName: 'wazer', rank: 5, isAreaManager: true,
          isStaff: false, areas: [], managedAreas: [{ id: 9001, name: 'Área SP' }] } });
        const depois = ler();
        closeModal('filtersModal');
        return { antes, depois };
      }, { casa: [REF.lat, REF.lon], trabalho: null });
      checa(semPerfil.antes.ordem === 'casa', `${id}: sem o perfil, "Perto de casa" salvo sumiu do seletor (F2)`, JSON.stringify(semPerfil.antes));
      checa(semPerfil.antes.area === '9001' && semPerfil.antes.areaTxt === semPerfil.antes.carregando,
        `${id}: sem o perfil, a área salva não aparece dizendo que carrega (F2)`, JSON.stringify(semPerfil.antes));
      checa(semPerfil.depois.ordem === 'casa' && semPerfil.depois.area === '9001' && semPerfil.depois.areaTxt === 'Área SP',
        `${id}: o perfil chegou com os Filtros abertos e eles não se redesenharam (F2)`, JSON.stringify(semPerfil.depois));

      // 6. SEM casa/trabalho no perfil: as duas opções somem (não viram beco).
      const semRefs = await abrir({ casa: null, trabalho: null });
      checa(!semRefs.includes('casa') && !semRefs.includes('trabalho'),
        `${id}: perfil sem endereço e as opções continuaram no select`, semRefs.join(','));
      checa(semRefs.includes('newest') && semRefs.includes('oldest'),
        `${id}: CONTROLE falhou — as opções de sempre sumiram junto`, semRefs.join(','));

      checa(errosG.length === 0, `${id}: erro de JS`, errosG[0]);
      await ctx.close();
    }
  }

  // 7. A permissão CONCEDIDA e a posição que NÃO vem (F4): o caminho de verdade
  //    da auditoria — antes, a dica mandava liberar a permissão que já estava
  //    liberada. MEDIDO no Chromium: sem posição nenhuma, o código 3 (tempo
  //    esgotado) aos 10 s; o `GPS_TIMEOUT_MS` do app é o mesmo, então o passo
  //    leva esses 10 s. Uma vez só, num aparelho.
  if (!pularForaDoChromium(MOTOR, 'perto de mim: a permissão concedida e a posição que não vem (o código 3 de verdade)',
    'o WebKit do Playwright entrega uma posição de mentira com a permissão concedida (MEDIDO: em 15 ms, sem erro); o "sem posição" de verdade só o Chromium dá, aos 10 s')) {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'pt-BR', serviceWorkers: 'block' });
    await ctx.grantPermissions(['geolocation'], { origin: BASE.replace(/\/$/, '') });
    const page = await ctx.newPage();
    const errosG = [];
    page.on('pageerror', (e) => errosG.push(String(e)));
    await page.addInitScript(() => localStorage.setItem('waze_places_preferences',
      JSON.stringify({ undoEnabled: true, comoFuncionaVisto: true })));
    await page.goto(BASE, { waitUntil: 'load' });
    await esperarOuExplodir(page, () => typeof AppState !== 'undefined', 'AppState');
    const r = await page.evaluate(async () => {
      AppState.authenticated = true;
      AppState.profile = { id: 1, userName: 'wazer', rank: 5, isAreaManager: true, isStaff: false, areas: [], managedAreas: [] };
      AppState.countries = [{ id: 30, name: 'Brazil' }];
      guardarReferencias({ referencias: { casa: null, trabalho: null } });
      openFiltersModal(); switchFilterTab('filtersTabFilters');
      const sel = document.getElementById('filterSort');
      sel.value = 'gps';
      await aoTrocarOrdenacao();
      const dica = document.getElementById('filterSortHint');
      return { valor: sel.value, dica: (dica.textContent || '').trim(), aplicarVivo: !document.getElementById('applyFilters').disabled,
               semPosicao: t('filters.sort.hint.semPosicao', { padrao: t('filters.sort.newest') }) };
    });
    checa(r.valor === 'newest', `${onde}: sem posição, "Perto de mim" ficou escolhido`, r.valor);
    checa(r.dica === r.semPosicao, `${onde}: com a permissão CONCEDIDA e sem posição, a dica não disse "sem posição" (F4)`, r.dica);
    checa(r.aplicarVivo, `${onde}: a posição que não veio deixou o "Aplicar" morto`);
    checa(errosG.length === 0, `${onde} (sem posição): erro de JS`, errosG[0]);
    await ctx.close();
  }
}

// ── Filtros: o LUGAR (região e país) que muda por baixo ──────────────────
// Os achados 10, 11 e 12 da auditoria de 2026-09-29, pelo caminho de VERDADE:
// o atalho do PWA (`/?action=filters`) abre os Filtros ANTES do perfil, e a
// carga da abertura da ROW (o perfil e os países) fica SEGURA na rota até o
// teste soltar. O fim de cada carga se espera pela promessa dela
// (`AppState._profilePromise`), nunca por prazo.
//   10. A pessoa aplica NA/EUA com a carga no ar; o perfil da ROW chegava
//       depois e a levava pro Brasil DENTRO da NA (`na/30`).
//   11. O perfil que chega troca o país aplicado com os Filtros abertos; o
//       seletor seguia no de antes, e o "Aplicar" o devolvia.
//   12. Trocar a região no modal e voltar pra aplicada escolhia o 1º país da
//       lista (`na/40`, o Canadá) em vez do aplicado.
//   R56-6. Trocar a região NA → ROW → NA: a lista da ida à NA que chegava
//       DEPOIS punha o 1º da lista (o Canadá) por cima dos EUA que a pessoa
//       tinha escolhido (auditoria da rodada 5).
//   11, com a REGIÃO. Quem só edita na NA abre os Filtros com a lista de
//       países da ROW no ar; o perfil a leva pra NA/EUA, e a lista da ROW,
//       chegando depois, ficava debaixo do seletor em `row` com os países da
//       NA: o "Aplicar" gravava `row/235`, uma fila vazia (lote 9).
//   R8-6-04. Pelo atalho, a carga da abertura e os Filtros pediam a MESMA
//       lista de países duas vezes; hoje é uma ida só, dividida.
//   R9-6-01. A lista que já CHEGOU saía de novo: a ida e a volta de região no
//       modal e o "Aplicar" + reabrir os Filtros pediam a da memória; hoje ela
//       fica guardada por região.
// CONTROLES: sem ninguém mexer, o perfil AINDA leva quem edita na França pra
// França (o instrumento enxerga a decisão automática), a escolha de OUTRO país
// no modal vale, a região que não é a aplicada abre no 1º da lista, com uma
// ida só à NA a escolha da pessoa fica, com a lista da abertura chegando
// ANTES do perfil a tela acompanha, e a lista da NA que FALHA na 1ª ida é
// pedida de novo na volta (a contagem enxerga a 2ª ida quando ela existe).
{
  const onde = 'filtros/lugar';
  const LISTAS = {
    row: [{ id: 30, name: 'Brazil' }, { id: 73, name: 'France' }, { id: 181, name: 'Portugal' }],
    na: [{ id: 235, name: 'United States' }, { id: 40, name: 'Canada' }],
  };
  // `falhar`: as N primeiras listas de países de cada região respondem falha
  // na hora (`{ row: 1 }` é a da carga da abertura, ver o "11, com a REGIÃO"),
  // e só as seguintes ficam seguras. `listasDaRow` conta as da ROW que a ROTA
  // recebeu (R8-6-04), e `listas` as de cada região (R9-6-01).
  const montar = async ({ editaveis, editaveisLa = {}, segurar = false, guardado = {}, falhar = {} }) => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'pt-BR', serviceWorkers: 'block' });
    await ctx.addInitScript((guardado) => {
      try {
        if (sessionStorage.getItem('__lugar')) return;
        sessionStorage.setItem('__lugar', '1');
        localStorage.setItem('waze_session_token', 'tok-smoke-lugar');
        for (const [k, v] of Object.entries(guardado)) localStorage.setItem(k, v);
      } catch (e) { /* armazenamento bloqueado: o teste segue */ }
    }, guardado);
    const seguros = [];
    // R56-6: as listas de países das TROCAS de região, seguras na ordem em que saem.
    const trocas = { segurar: false, seguras: [] };
    const contagem = { listasDaRow: 0, listas: {} };
    await ctx.route('**/api/**', async (route) => {
      const nome = route.request().url().split('/api/')[1].split(/[?#]/)[0];
      let corpo = {};
      try { corpo = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* sem corpo */ }
      const regiao = corpo.region || 'row';
      let b = { success: true };
      if (nome === 'perfil') {
        b = { success: true, visivelNoWme: true, profile: { id: 12444348, userName: 'wazer', rank: 5, isAreaManager: true,
          isStaff: false, areas: [], managedAreas: [], editableCountryIDs: regiao === 'row' ? editaveis : (editaveisLa[regiao] || []) } };
      } else if (nome === 'lista-paises') b = { success: true, countries: LISTAS[regiao] || [] };
      else if (nome === 'lista-estados') b = { success: true, states: [] };
      else if (nome === 'buscar-places') b = { success: true, places: [], hasMore: false, page: 1, total: 0, totalAll: 0, blocked: 0 };
      else if (nome === 'presenca-app') b = { success: true, online: [], conversas: [] };
      const daRow = nome === 'lista-paises' && regiao === 'row';
      if (daRow) contagem.listasDaRow++;
      if (nome === 'lista-paises') contagem.listas[regiao] = (contagem.listas[regiao] || 0) + 1;
      if (nome === 'lista-paises' && contagem.listas[regiao] <= (falhar[regiao] || 0)) {
        b = { success: false, errorCategory: 'transient' };
      } else if (segurar && regiao === 'row' && (nome === 'perfil' || nome === 'lista-paises')) {
        await new Promise((solta) => seguros.push({ nome, solta }));
      } else if (trocas.segurar && nome === 'lista-paises') {
        await new Promise((solta) => trocas.seguras.push({ regiao, solta }));
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) }).catch(() => {});
    });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e.message || e)));
    const soltar = (nome) => {
      for (const s of seguros.filter((x) => !nome || x.nome === nome)) { seguros.splice(seguros.indexOf(s), 1); s.solta(); }
    };
    // Só o PRIMEIRO seguro daquele nome (na ordem em que a rota os recebeu).
    const soltarUm = (nome) => {
      const s = seguros.find((x) => x.nome === nome);
      if (s) { seguros.splice(seguros.indexOf(s), 1); s.solta(); }
    };
    const segurosDe = (nome) => seguros.filter((x) => x.nome === nome).length;
    return { ctx, page, erros, soltar, soltarUm, segurosDe, trocas, contagem };
  };
  const pelosFiltros = async (m) => {
    await m.page.goto(BASE + '?action=filters', { waitUntil: 'domcontentloaded' });
    await esperarOuExplodir(m.page, () => typeof AppState !== 'undefined'
      && !document.getElementById('filtersModal').classList.contains('hidden'), 'os Filtros pelo atalho');
  };
  const fimDaCarga = (m) => m.page.evaluate(async () => { await AppState._profilePromise; return API.getRegion() + '/' + API.getCountry(); });

  // 10. A carga da abertura chegando DEPOIS de a pessoa aplicar NA/EUA.
  {
    const m = await montar({ editaveis: [30], segurar: true });
    await pelosFiltros(m);
    await m.page.evaluate(() => { const s = document.getElementById('filterRegion'); s.value = 'na'; s.dispatchEvent(new Event('change')); });
    await esperarOuExplodir(m.page, () => !!document.querySelector('#filterCountry option[value="235"]')
      && !document.getElementById('applyFilters').disabled, 'os países da NA');
    await m.page.evaluate(() => {
      const s = document.getElementById('filterCountry');
      s.value = '235'; s.dispatchEvent(new Event('change'));
      document.getElementById('applyFilters').click();
    });
    await esperarOuExplodir(m.page, () => API.getRegion() === 'na' && API.getCountry() === 235, 'o "Aplicar" da NA/EUA');
    m.soltar();
    const lugar = await fimDaCarga(m);
    const cache = await m.page.evaluate(() => AppState.countries.map((c) => c.id));
    checa(lugar === 'na/235', `${onde}: a carga da abertura chegou depois do "Aplicar" e tirou a pessoa da NA/EUA (achado 10)`, lugar);
    checa(!cache.includes(30), `${onde}: a lista de países da ROW virou a da NA (achado 10)`, cache.join(','));
    checa(m.erros.length === 0, `${onde} (10): erro de JS`, m.erros[0]);
    await m.ctx.close();
  }
  {
    const m = await montar({ editaveis: [73] });
    await m.page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await esperarOuExplodir(m.page, () => typeof AppState !== 'undefined' && !!AppState._profilePromise, 'a carga do perfil');
    const lugar = await fimDaCarga(m);
    checa(lugar === 'row/73', `${onde}: CONTROLE — sem ninguém mexer, o perfil não levou quem edita na França pra França`, lugar);
    await m.ctx.close();
  }

  // 11. O perfil troca o país com os Filtros ABERTOS — e, no CONTROLE, a pessoa
  //     já tinha escolhido Portugal no modal.
  for (const escolheu of [null, '181']) {
    const m = await montar({ editaveis: [73], segurar: true });
    await pelosFiltros(m);
    m.soltar('lista-paises');   // os países chegam antes do perfil: o seletor mostra o Brasil
    await esperarOuExplodir(m.page, () => document.getElementById('filterCountry').value === '30'
      && !document.getElementById('filterCountry').dataset.carregando, 'o Brasil no seletor');
    if (escolheu) {
      await m.page.evaluate((v) => { const s = document.getElementById('filterCountry'); s.value = v; s.dispatchEvent(new Event('change')); }, escolheu);
    }
    m.soltar('perfil');
    await fimDaCarga(m);
    const r = await m.page.evaluate(() => {
      const naTela = document.getElementById('filterCountry').value;
      document.querySelector('.filter-type[value="DELETE_PHOTO"]').checked = false;
      document.getElementById('applyFilters').click();
      return { naTela, depois: String(API.getCountry()) };
    });
    const esperado = escolheu || '73';
    checa(r.naTela === esperado, escolheu
      ? `${onde}: o país que a pessoa escolheu no modal foi atropelado pelo do perfil (achado 11)`
      : `${onde}: o perfil trocou o país pra França com os Filtros abertos e o seletor seguiu no Brasil (achado 11)`, r.naTela);
    checa(r.depois === esperado, `${onde}: o "Aplicar" gravou ${r.depois}, e a tela dizia ${r.naTela} (achado 11)`);
    checa(m.erros.length === 0, `${onde} (11): erro de JS`, m.erros[0]);
    await m.ctx.close();
  }

  // 12. Aplicado NA/EUA: ida à ROW e volta no modal.
  {
    const m = await montar({ editaveis: [], guardado: { waze_region: 'na', waze_country: '235' } });
    await m.page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await esperarOuExplodir(m.page, () => typeof AppState !== 'undefined' && !!AppState._profilePromise, 'a carga do perfil');
    await fimDaCarga(m);
    await m.page.evaluate(() => { openFiltersModal(); switchFilterTab('filtersTabFilters'); });
    await esperarOuExplodir(m.page, () => document.getElementById('filterCountry').value === '235', 'os EUA no seletor');
    // A função da espera vai SERIALIZADA pra página: o id que ela procura vai
    // antes, por argumento do `evaluate` (uma variável do Node dentro dela
    // chegaria `undefined` — gotcha #28).
    const naRegiao = async (r, id) => {
      await m.page.evaluate(({ r, id }) => {
        window.__paisEsperado = String(id);
        const s = document.getElementById('filterRegion'); s.value = r; s.dispatchEvent(new Event('change'));
      }, { r, id });
      await esperarOuExplodir(m.page, () => !!document.querySelector(`#filterCountry option[value="${window.__paisEsperado}"]`)
        && !document.getElementById('applyFilters').disabled, `os países da ${r}`);
      return m.page.evaluate(() => document.getElementById('filterCountry').value);
    };
    const naRow = await naRegiao('row', 30);
    const deVolta = await naRegiao('na', 235);
    checa(naRow === '30', `${onde}: CONTROLE — a região que não é a aplicada não abriu no 1º da lista`, naRow);
    checa(deVolta === '235', `${onde}: voltou pra região aplicada e o seletor escolheu ${deVolta} em vez dos EUA (achado 12)`, deVolta);
    const gravado = await m.page.evaluate(() => { document.getElementById('applyFilters').click(); return API.getRegion() + '/' + API.getCountry(); });
    checa(gravado === 'na/235', `${onde}: foi à ROW e voltou, e o "Aplicar" gravou ${gravado} (achado 12)`, gravado);
    checa(m.erros.length === 0, `${onde} (12): erro de JS`, m.erros[0]);
    await m.ctx.close();
  }

  // R56-6. Aplicado ROW/Brasil, a região vai NA → ROW → NA no modal com as
  //        listas seguras, e elas chegam numa ordem; a pessoa escolhe os EUA
  //        ASSIM QUE O SELETOR DEIXA (a lista na tela, sem "carregando",
  //        destravado). O pouso de cada resposta se espera pelo registro dela
  //        no anel de chamadas do app (`API.chamadas`), que é escrito ANTES de
  //        a troca continuar — e a contagem é a que CRESCEU desde a base
  //        fotografada depois da abertura (gotcha #62), nunca por prazo.
  //        Desde o R9-6-01 a volta à NA DIVIDE a ida que está no ar e a lista
  //        que chegou vem da memória: é UMA ida por região, e o que sobra do
  //        R56-6 é a lista de OUTRA região chegando depois. A ida à ROW só é de
  //        verdade com a lista da ROW fora da memória: aqui ela falha na carga e
  //        na abertura dos Filtros (`falhar: { row: 2 }`).
  for (const [caso, regioes, ordem] of [
    ['a da NA chega antes (a da ROW, depois)', ['na', 'row', 'na'], [0, 1]],
    ['a da ROW chega antes', ['na', 'row', 'na'], [1, 0]],
    ['CONTROLE: uma ida só à NA', ['na'], [0]],
  ]) {
    const m = await montar({ editaveis: [30], falhar: { row: 2 } });
    await m.page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await esperarOuExplodir(m.page, () => typeof AppState !== 'undefined' && !!AppState._profilePromise, 'a carga do perfil');
    await fimDaCarga(m);
    await m.page.evaluate(() => { openFiltersModal(); switchFilterTab('filtersTabFilters'); });
    // A da carga e a dos Filtros FALHARAM (as duas pousaram no anel), e o
    // seletor diz "Lista não carregou".
    await esperarOuExplodir(m.page, () => API.chamadas.filter((c) => c.rota === 'lista-paises').length >= 2
      && document.getElementById('filterCountry').dataset.carregando === '1', 'a lista da ROW dos Filtros falhar');
    const base = await m.page.evaluate(() => API.chamadas.filter((c) => c.rota === 'lista-paises').length);
    m.trocas.segurar = true;
    for (const r of regioes) {
      await m.page.evaluate((r) => { const s = document.getElementById('filterRegion'); s.value = r; s.dispatchEvent(new Event('change')); }, r);
    }
    // Uma ida por REGIÃO saiu e está segura (a rota as recebe fora do `evaluate`).
    const esperadas = [...new Set(regioes)].join(',');
    for (let i = 0; i < 100 && m.trocas.seguras.length < esperadas.split(',').length; i++) await m.page.waitForTimeout(20);
    const seguradas = m.trocas.seguras.map((x) => x.regiao).join(',');
    checa(seguradas === esperadas, `${onde} (R56-6, ${caso}): CONTROLE — o instrumento não segurou as listas das trocas (uma ida por região, R9-6-01)`, seguradas);
    if (seguradas !== esperadas) { await m.ctx.close(); continue; }
    let escolheuApos = null;
    for (let k = 0; k < ordem.length; k++) {
      m.trocas.seguras[ordem[k]].solta();
      await m.page.evaluate((n) => { window.__r56Pousos = n; }, base + k + 1);
      await esperarOuExplodir(m.page, () => API.chamadas.filter((c) => c.rota === 'lista-paises').length >= window.__r56Pousos,
        `a resposta ${k + 1} pousar`);
      if (escolheuApos !== null) continue;
      const pode = await m.page.evaluate(() => {
        const s = document.getElementById('filterCountry');
        return !s.dataset.carregando && !s.disabled && !!s.querySelector('option[value="235"]');
      });
      if (pode) {
        await m.page.evaluate(() => { const s = document.getElementById('filterCountry'); s.value = '235'; s.dispatchEvent(new Event('change')); });
        escolheuApos = k + 1;
      }
    }
    const fim = await m.page.evaluate(() => ({
      pais: document.getElementById('filterCountry').value,
      aplicarMorto: document.getElementById('applyFilters').disabled,
    }));
    checa(escolheuApos !== null, `${onde} (R56-6, ${caso}): o seletor de país nunca deixou a pessoa escolher`);
    checa(fim.pais === '235', `${onde} (R56-6, ${caso}): a pessoa escolheu os EUA e a lista que chegou depois pôs o ${fim.pais}`, fim.pais);
    checa(!fim.aplicarMorto, `${onde} (R56-6, ${caso}): o "Aplicar" ficou morto`);
    const gravado = await m.page.evaluate(() => { document.getElementById('applyFilters').click(); return API.getRegion() + '/' + API.getCountry(); });
    checa(gravado === 'na/235', `${onde} (R56-6, ${caso}): o "Aplicar" gravou ${gravado}`, gravado);
    // R9-6-01: no fim de tudo, a lista da NA saiu UMA vez (a volta à NA dividiu a ida).
    checa(m.contagem.listas.na === 1, `${onde} (R56-6, ${caso}): a lista da NA saiu ${m.contagem.listas.na} vezes (R9-6-01)`);
    checa(m.erros.length === 0, `${onde} (R56-6): erro de JS`, m.erros[0]);
    await m.ctx.close();
  }

  // R9-6-01. A lista que CHEGOU não sai de novo: aplicado ROW/Brasil, a pessoa
  //     vai à NA, volta à ROW e vai à NA de novo no modal, escolhe os EUA,
  //     aplica e reabre os Filtros. Eram 2 da ROW e 2 da NA (MEDIDO, auditoria
  //     da rodada 9); hoje 1 e 1, e a lista da região aplicada fica na memória
  //     depois do "Aplicar" (o "Aplicar" a jogava fora). CONTROLE: com a 1ª
  //     lista da NA FALHANDO, a volta à NA a pede de novo — a contagem enxerga
  //     a 2ª ida quando ela existe, e a que falhou não fica guardada.
  for (const controle of [false, true]) {
    const caso = controle ? 'CONTROLE: a 1ª da NA falha' : 'ida e volta, "Aplicar" e reabrir';
    const m = await montar({ editaveis: [30], falhar: controle ? { na: 1 } : {} });
    await m.page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await esperarOuExplodir(m.page, () => typeof AppState !== 'undefined' && !!AppState._profilePromise, 'a carga do perfil');
    await fimDaCarga(m);
    await m.page.evaluate(() => { openFiltersModal(); switchFilterTab('filtersTabFilters'); });
    await esperarOuExplodir(m.page, () => document.getElementById('filterCountry').value === '30'
      && !document.getElementById('filterCountry').dataset.carregando, 'o Brasil no seletor');
    // A troca acabou quando o "Aplicar" não espera mais por ela.
    const naRegiao = async (r) => {
      await m.page.evaluate((r) => { const s = document.getElementById('filterRegion'); s.value = r; s.dispatchEvent(new Event('change')); }, r);
      await esperarOuExplodir(m.page, () => !esperaDosFiltros.regiao && !document.getElementById('applyFilters').disabled,
        `a troca de região acabar`);
    };
    for (const r of ['na', 'row', 'na']) await naRegiao(r);
    const naTela = await m.page.evaluate(() => document.getElementById('filterRegion').value);
    checa(naTela === 'na', `${onde} (R9-6-01, ${caso}): PRÉ-CONDIÇÃO — a última troca não ficou na NA`, naTela);
    await m.page.evaluate(() => {
      const s = document.getElementById('filterCountry'); s.value = '235'; s.dispatchEvent(new Event('change'));
      document.getElementById('applyFilters').click();
    });
    const memoria = await m.page.evaluate(() => ({ lugar: API.getRegion() + '/' + API.getCountry(), paises: AppState.countries.map((c) => c.id) }));
    checa(memoria.lugar === 'na/235', `${onde} (R9-6-01, ${caso}): PRÉ-CONDIÇÃO — o "Aplicar" gravou ${memoria.lugar}`);
    checa(memoria.paises.includes(235), `${onde} (R9-6-01, ${caso}): o "Aplicar" jogou fora a lista da região que a troca trouxe`, memoria.paises.join(','));
    // Reabre os Filtros (depois de o voltar do fechamento assentar, gotcha #65).
    await esperarOuExplodir(m.page, () => !CamadaVoltar.consumindo, 'o voltar do fechamento assentar');
    await m.page.evaluate(() => { void openFiltersModal(); });
    await esperarOuExplodir(m.page, () => document.getElementById('filterCountry').value === '235'
      && !document.getElementById('filterCountry').dataset.carregando, 'os EUA no seletor reaberto');
    const esperado = controle ? { row: 1, na: 2 } : { row: 1, na: 1 };
    const contou = { row: m.contagem.listas.row || 0, na: m.contagem.listas.na || 0 };
    checa(contou.row === esperado.row && contou.na === esperado.na,
      controle ? `${onde} (R9-6-01, ${caso}): CONTROLE — a lista da NA que falhou não foi pedida de novo (ou a contagem não a viu)`
        : `${onde} (R9-6-01, ${caso}): a lista de países saiu de novo com ela na memória`, JSON.stringify(contou));
    checa(m.erros.length === 0, `${onde} (R9-6-01): erro de JS`, m.erros[0]);
    await m.ctx.close();
  }

  // 11, com a REGIÃO. Quem só edita na NA (o perfil da ROW sem país, o da NA com
  //     os EUA) abre os Filtros com o perfil seguro e a lista de países da ROW
  //     dos Filtros no ar. A carga da abertura e os Filtros abertos com ela no
  //     ar DIVIDEM a lista (R8-6-04): a dos Filtros só é uma ida própria quando
  //     a da carga não serviu — aqui, ela FALHA, e os Filtros abrem depois
  //     (pelo botão, não pelo atalho, que os abriria dividindo a ida da carga).
  //     A dos Filtros fica no ar até o perfil levar a pessoa pra NA/EUA. No
  //     CONTROLE ela chega antes.
  for (const listaAntes of [false, true]) {
    const caso = listaAntes ? 'CONTROLE: a lista da abertura chega ANTES do perfil' : 'a lista da abertura chega DEPOIS do perfil';
    const m = await montar({ editaveis: [], editaveisLa: { na: [235] }, segurar: true, falhar: { row: 1 } });
    await m.page.goto(BASE, { waitUntil: 'domcontentloaded' });
    // A lista da carga POUSOU (falhando): o registro dela no anel de chamadas.
    await esperarOuExplodir(m.page, () => typeof API !== 'undefined' && API.chamadas.some((c) => c.rota === 'lista-paises'),
      'a lista da carga falhar');
    // Os Filtros abertos pelo botão, com o perfil ainda seguro. Sem esperar a
    // promessa do `openFiltersModal` (ela espera a lista que o teste segura).
    await m.page.evaluate(() => { void openFiltersModal(); });
    for (let i = 0; i < 100 && m.segurosDe('lista-paises') < 1; i++) await m.page.waitForTimeout(20);
    checa(m.segurosDe('lista-paises') === 1 && m.contagem.listasDaRow === 2,
      `${onde} (11, região, ${caso}): CONTROLE — o instrumento não segurou a lista dos Filtros (a da carga falhou antes)`,
      `seguras ${m.segurosDe('lista-paises')} · da ROW ${m.contagem.listasDaRow}`);
    const carregando = await m.page.evaluate(() => document.getElementById('filterCountry').dataset.carregando === '1');
    checa(carregando, `${onde} (11, região, ${caso}): CONTROLE — a lista da abertura não estava no ar`);
    if (listaAntes) m.soltar('lista-paises');
    m.soltar('perfil');
    // O perfil leva pra NA/EUA. Se a lista segura fosse a da carga, o perfil nem
    // andaria e isto estoura — o instrumento não mede o caso fácil.
    const lugar = await fimDaCarga(m);
    checa(lugar === 'na/235', `${onde} (11, região, ${caso}): CONTROLE — o perfil não levou quem só edita na NA pra NA/EUA`, lugar);
    if (!listaAntes) {
      // A lista da abertura chega agora. O pouso se espera pelo registro dela no
      // anel de chamadas do app, contado a partir de agora (gotcha #62).
      const base = await m.page.evaluate(() => API.chamadas.filter((c) => c.rota === 'lista-paises').length);
      m.soltar('lista-paises');
      await m.page.evaluate((n) => { window.__listaDaAbertura = n; }, base + 1);
      await esperarOuExplodir(m.page, () => API.chamadas.filter((c) => c.rota === 'lista-paises').length >= window.__listaDaAbertura,
        'a lista da abertura pousar');
    }
    const tela = await m.page.evaluate(() => ({
      regiao: document.getElementById('filterRegion').value,
      pais: document.getElementById('filterCountry').value,
      opcoes: [...document.getElementById('filterCountry').options].map((o) => o.value).join(','),
      dica: !document.getElementById('filterCountryHint').classList.contains('hidden'),
      aplicarMorto: document.getElementById('applyFilters').disabled,
    }));
    const naTela = `${tela.regiao}/${tela.pais} com os países ${tela.opcoes}`;
    checa(tela.regiao === 'na' && tela.pais === '235', `${onde} (11, região, ${caso}): o perfil levou pra NA/EUA e a tela ficou em ${naTela}`);
    checa(!tela.opcoes.split(',').includes('30'), `${onde} (11, região, ${caso}): a lista da ROW ficou na tela da NA`, tela.opcoes);
    // R7-6-02: a lista do NA que o perfil leu fica pra peneira — a mesma da
    // reabertura (só os EUA, com a dica); sem isso, o Canadá era opção.
    checa(tela.opcoes === '235' && tela.dica, `${onde} (11, região, ${caso}): a 1ª sessão de quem só edita na NA mostra a lista do NA sem a peneira (R7-6-02)`,
      `${tela.opcoes} · dica ${tela.dica}`);
    checa(!tela.aplicarMorto, `${onde} (11, região, ${caso}): o "Aplicar" ficou morto`);
    const gravado = await m.page.evaluate(() => { document.getElementById('applyFilters').click(); return API.getRegion() + '/' + API.getCountry(); });
    checa(gravado === 'na/235', `${onde} (11, região, ${caso}): o "Aplicar" gravou ${gravado} (a fila de quem só edita na NA)`, gravado);
    checa(m.erros.length === 0, `${onde} (11, região): erro de JS`, m.erros[0]);
    await m.ctx.close();
  }

  // R7-6-01. O perfil chega com os Filtros abertos pelo atalho SEM mudar o
  //     lugar (a pessoa já está onde edita): a lista que estava na tela — todos
  //     os países, sem a dica — passa pela peneira dele. Sem isso, dava pra
  //     escolher e aplicar um país que ela não edita DEPOIS de o perfil chegar
  //     (fila vazia). PRÉ-CONDIÇÃO: antes do perfil a lista é a inteira (o
  //     instrumento enxerga a diferença).
  {
    const m = await montar({ editaveis: [30], segurar: true });
    await pelosFiltros(m);
    m.soltar('lista-paises');
    await esperarOuExplodir(m.page, () => document.getElementById('filterCountry').value === '30'
      && !document.getElementById('filterCountry').dataset.carregando, 'o Brasil no seletor');
    const ler = () => m.page.evaluate(() => ({
      opcoes: [...document.getElementById('filterCountry').options].map((o) => o.value).join(','),
      pais: document.getElementById('filterCountry').value,
      dica: !document.getElementById('filterCountryHint').classList.contains('hidden'),
    }));
    const antes = await ler();
    checa(antes.opcoes === '30,73,181' && !antes.dica, `${onde} (R7-6-01): PRÉ-CONDIÇÃO — antes do perfil a lista não era a inteira`, JSON.stringify(antes));
    m.soltar('perfil');
    const lugar = await fimDaCarga(m);
    checa(lugar === 'row/30', `${onde} (R7-6-01): PRÉ-CONDIÇÃO — o perfil mudou o lugar`, lugar);
    const depois = await ler();
    checa(depois.opcoes === '30' && depois.pais === '30' && depois.dica,
      `${onde} (R7-6-01): o perfil chegou com os Filtros abertos e a lista seguiu sem a peneira`, JSON.stringify(depois));
    // R8-6-04: pelo atalho, a carga da abertura e os Filtros DIVIDEM a ida da
    // lista da ROW — eram duas, cada uma um pedido ao `/api` e uma ida ao Waze.
    // CONTROLE de que a contagem enxerga a 2ª: no "11, com a REGIÃO", acima, a
    // rota conta 2 (a da carga, que falhou, e a dos Filtros abertos depois).
    checa(m.contagem.listasDaRow === 1,
      `${onde} (R8-6-04): pelo atalho, a lista de países da ROW saiu ${m.contagem.listasDaRow} vezes — a carga e os Filtros pediam a mesma`);
    checa(m.erros.length === 0, `${onde} (R7-6-01): erro de JS`, m.erros[0]);
    await m.ctx.close();
  }
}

// ── Patentes e Conquistas: os três defeitos que só a TELA mostra ─────────
// A medição de layout deste app já dava tudo verde nos três, e todos os três
// chegaram a existir na rodada de mockup:
//   • PALAVRA PARTIDA NO MEIO ("Colecionad / or"). Não é corte (`scrollHeight`
//     não vê) nem estouro (`scrollWidth` não vê). Só um Range por palavra,
//     contando em quantas LINHAS ela caiu.
//   • SOBREPOSIÇÃO no estreito (o total por cima do nome da patente). Só
//     `elementFromPoint`, nunca retângulo (gotcha #26).
//   • CONTRASTE do texto trancado. Cor SÓLIDA e medida, porque `opacity` em
//     texto mistura com o fundo sem aparecer no `getComputedStyle().color`.
// E o portão: L6+AM vê 16 conquistas, quem não passa vê 14 — com CONTRAPROVA
// dos dois lados, senão "não apareceu" passaria também se a grade sumisse.
{
  const CENAS = [
    ['Pixel 7', { width: 412, height: 915 }, 'light', 5, 16],
    ['Pixel 7', { width: 412, height: 915 }, 'dark', 5, 16],
    ['Galaxy Fold', { width: 280, height: 653 }, 'light', 5, 16],
    ['Galaxy Fold', { width: 280, height: 653 }, 'dark', 5, 16],
    ['iPhone SE', { width: 320, height: 568 }, 'light', 1, 14],
  ];
  for (const [nome, viewport, tema, rank, esperadas] of CENAS) {
    for (const lang of LINGUAS) {
      const id = `conquistas ${nome}/${tema}/${lang}/L${rank + 1}`;
      const ctx = await browser.newContext({ viewport, locale: lang, serviceWorkers: 'block', colorScheme: tema });
      // Abrir os Filtros pede a lista de países, que leva 401 com a sessão
      // falsa — e toda resposta prova rede, o que faz a presença pedir o token
      // do tempo real (`Presenca.aoProvarRede`, v2026.09.26-01). A sentinela do
      // 401 da presença pegou os 20 contextos deste bloco na primeira rodada.
      await presencaViva(ctx);
      const page = await ctx.newPage();
      const errosJS = [];
      page.on('pageerror', (e) => errosJS.push(String(e.message || e).split('\n')[0]));
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(350);
      const r = await page.evaluate(({ tema, lang, rank }) => {
        setLang(lang); applyTheme(tema);
        AppState.authenticated = true;
        AppState.profile = { id: 1, userName: 'a', rank, isAreaManager: true, isStaff: false };
        AppState.preferences = AppState.preferences || {}; AppState.preferences.comoFuncionaVisto = true;
        // 4 DÍGITOS de propósito: com 3 o separador nem aparece e a comparação
        // de formato entre placar e cartão passaria sem medir nada.
        AppState.stats = { read: 1430, rejected: 1610, skipped: 35 };
        AppState.serverTotal = 3311; AppState.hasMore = false;
        API.setSession('x'); API.setCountry(30);
        AppState.filters = Object.assign({}, AppState.filters, { stateId: '5' });
        AppState.history = null;
        localStorage.setItem('waze_places_history', JSON.stringify({
          _total: { read: 1430, rejected: 1610 },
          '2026-09-14': { read: 41, rejected: 63, onde: { '30:5': 104 } },
          '2026-09-13': { read: 60, rejected: 70, onde: { '30:7': 130 } },
          '2026-09-12': { read: 50, rejected: 40, onde: { '73:2': 90 } },
          '2026-08-01': { read: 10, rejected: 5 },   // balde ANTIGO, sem `onde`
        }));
        AppState.conquistas = null; localStorage.removeItem('waze_places_conquistas');
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.remove('hidden');
        renderProfileHeader(); updateStats(true); updatePendingCount(true); showLoading(false);
        const numPlacar = document.getElementById('readCount').textContent;
        // A ORDEM AQUI É O TESTE, e errá-la dá defeito que parece do produto:
        // medir o placar com o modal ABERTO acusa 13/13 (o scrim cobre tudo), e
        // destravar DEPOIS do render deixa a vitrine sem anel. Aconteceu nas
        // duas, na primeira rodada. Então: base → destrava → mede a tela do
        // CARD → só então abre o modal.
        checarConquistas();                 // 1. a LINHA DE BASE, que é silenciosa
        checarConquistas({ madrugada: true });  // 2. destrava UMA de verdade
        const g = carregarConquistas();
        const seloAceso = !document.getElementById('conqSelo').classList.contains('hidden');
        const ariaComSelo = document.getElementById('filtersBtn').getAttribute('aria-label') || '';
        const bannerNoAviso = document.querySelectorAll('#bannerContainer > *').length;
        const confeteNoAviso = document.querySelectorAll('.confetti-burst span').length;
        // 3. Quanto do PLACAR o aviso cobre? Mede a TINTA (gotcha #26), com o
        // modal FECHADO — `modalAberto` é o controle que denuncia o contrário.
        const modalAberto = [...document.querySelectorAll('.modal-root')]
          .filter((mm) => !mm.classList.contains('hidden')).map((mm) => mm.id);
        let placarCoberto = 0, placarPts = 0;
        const pl = document.getElementById('placar');
        if (pl) for (const el of pl.querySelectorAll('*')) {
          if (!el.firstChild || el.firstChild.nodeType !== 3 || !el.textContent.trim()) continue;
          const rg = document.createRange(); rg.selectNodeContents(el);
          const r = rg.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
          placarPts++;
          const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (t && t !== el && !el.contains(t) && !t.contains(el)) placarCoberto++;
        }
        // 4. Agora sim o modal: abrir a aba É ter visto — o selo apaga e o anel
        // FICA nesta abertura (some só na próxima).
        openFiltersModal(); switchFilterTab('filtersTabHistory');
        const seloApagou = document.getElementById('conqSelo').classList.contains('hidden');
        const anelVisivel = document.querySelectorAll('.conq-cel.nova').length;
        const numPatente = (document.querySelector('.conq-num') || {}).textContent || '';
        return { numPlacar, numPatente, seloAceso, ariaComSelo, bannerNoAviso, confeteNoAviso,
                 placarCoberto, placarPts, modalAberto,
                 seloApagou, anelVisivel,
                 base: g.base, ganhas: Object.keys(g.c).length,
                 andarilho: !!g.c.andarilho, viajante: !!g.c.viajante,
                 // O #bannerStack SEMPRE tem 1 filho (o posicionador
                 // #bannerContainer, `empty:hidden`): contar os filhos DELE.
                 banners: document.querySelectorAll('#bannerContainer > *').length,
                 temContainer: !!document.getElementById('bannerContainer') };
      }, { tema, lang, rank });
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => {
        const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const nums = (s) => { const x = String(s).match(/-?\d*\.?\d+/g); return x ? x.map(Number) : null; };
        const rgb = (s) => { const n = nums(s); return n && n.length >= 3 ? n.slice(0, 3) : null; };
        const alfa = (s) => { const n = nums(s); return n && n.length > 3 ? n[3] : 1; };
        const fundo = (el) => { let n = el; while (n && n !== document.documentElement) {
          const b = getComputedStyle(n).backgroundColor; if (b && alfa(b) === 1 && rgb(b)) return rgb(b); n = n.parentElement; }
          return [255, 255, 255]; };
        const contraste = (el) => { const f = rgb(getComputedStyle(el).color); if (!f) return null;
          const a = lum(f), b = lum(fundo(el));
          return +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2)); };
        const corpo = document.getElementById('historyBody');
        const partidas = (() => { const fora = [];
          const it = document.createTreeWalker(corpo, NodeFilter.SHOW_TEXT); let n;
          while ((n = it.nextNode())) { const t = n.nodeValue; if (!t || !t.trim()) continue;
            const re = /[^\s­‐-―-]{4,}/g; let x;
            while ((x = re.exec(t))) { const rg = document.createRange();
              rg.setStart(n, x.index); rg.setEnd(n, x.index + x[0].length);
              if (new Set([...rg.getClientRects()].map((q) => Math.round(q.top))).size > 1) fora.push(x[0]); } }
          return [...new Set(fora)]; })();
        const cobertos = (() => { const fora = [];
          for (const el of [...corpo.querySelectorAll('*')].filter((e) => e.firstChild
              && e.firstChild.nodeType === 3 && e.textContent.trim())) {
            el.scrollIntoView({ block: 'center' });
            const q = el.getBoundingClientRect(); if (q.width < 4 || q.height < 4) continue;
            for (const [fx, fy] of [[0.5, 0.5], [0.12, 0.5], [0.88, 0.5]]) {
              const top = document.elementFromPoint(q.left + q.width * fx, q.top + q.height * fy);
              if (top && top !== el && !el.contains(top) && !top.contains(el)) {
                fora.push((el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 16)); break; } } }
          corpo.scrollIntoView({ block: 'start' }); return [...new Set(fora)]; })();
        const pequenos = [...corpo.querySelectorAll('.conq-cel, .conq-link, .conq-deg')]
          .filter((e) => { const q = e.getBoundingClientRect(); return q.height < 44 || q.width < 44; })
          .map((e) => (e.textContent || '').trim().slice(0, 18) + ' '
             + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
        const tr = corpo.querySelector('.conq-cel.off .n'), gn = corpo.querySelector('.conq-cel.on .n');
        const painel = document.getElementById('filtersPanelHistory');
        // As COLUNAS têm que sair iguais. É o que uma tradução longa quebra
        // primeiro: um nome que não cabe força `min-width:auto` e estica só a
        // coluna dele — a vitrine deixa de ser uma grade e nada mais denuncia.
        const grade = corpo.querySelector('.conq-grade');
        const colunas = grade
          ? getComputedStyle(grade).gridTemplateColumns.split(' ').map((x) => Math.round(parseFloat(x)))
          : [];
        return { celulas: corpo.querySelectorAll('.conq-cel').length, colunas,
          cTrancado: tr ? contraste(tr) : null, cGanho: gn ? contraste(gn) : null,
          partidas, cobertos, pequenos,
          estouroH: Math.max(0, painel.scrollWidth - painel.clientWidth),
          cru: /conq\.[a-z]/i.test(corpo.textContent) };
      });

      // Contagem sai CRUA (decisão do owner): só dígito, em todo idioma. O
      // francês é quem denuncia primeiro — ele separa com espaço ESTREITO
      // (U+202F), que passa despercebido numa leitura rápida do log.
      checa(/^\d+$/.test(r.numPlacar),
        `${id}: o placar voltou a formatar número`, `"${r.numPlacar}"`);
      checa(/^\d+$/.test(r.numPatente),
        `${id}: o cartão da patente voltou a formatar número`, `"${r.numPatente}"`);
      checa(r.numPlacar.length >= 4 && r.numPatente.length >= 4,
        `${id}: CONTROLE falhou — número com menos de 4 dígitos não distingue cru de formatado`,
        `placar "${r.numPlacar}" × patente "${r.numPatente}"`);
      checa(r.temContainer, `${id}: CONTROLE falhou — o #bannerContainer sumiu, a contagem de banner não vale nada`);
      checa(r.base === true, `${id}: a linha de base não foi marcada`);
      checa(r.banners === 0, `${id}: a primeira passada anunciou ${r.banners} banner(s) — devia ser silenciosa`);
      checa(r.seloAceso, `${id}: destravou uma conquista e o selo do #filtersBtn não acendeu`);
      checa(r.bannerNoAviso === 0,
        `${id}: a conquista voltou a abrir banner`, `${r.bannerNoAviso} banner(s)`);
      checa(r.confeteNoAviso === 0,
        `${id}: a conquista voltou a soltar confete sobre o card`, `${r.confeteNoAviso} pedaços`);
      checa(r.modalAberto.length === 0,
        `${id}: CONTROLE falhou — medi o placar com modal aberto, o scrim cobre tudo`,
        r.modalAberto.join(','));
      checa(r.placarPts >= 8,
        `${id}: CONTROLE falhou — só achei ${r.placarPts} nós de texto no placar, a cobertura não vale nada`);
      checa(r.placarCoberto === 0,
        `${id}: o aviso cobre o placar`, `${r.placarCoberto} de ${r.placarPts} — o banner cobria 13 de 13`);
      checa(/\S/.test(r.ariaComSelo) && r.ariaComSelo.includes('—'),
        `${id}: o selo não anunciou no aria-label do botão`, `"${r.ariaComSelo}"`);
      checa(r.seloApagou === true,
        `${id}: abrir a aba Histórico não apagou o selo`);
      checa(r.anelVisivel >= 1,
        `${id}: a conquista nova não ganhou anel na vitrine`, `${r.anelVisivel} anel(éis)`);
      checa(r.andarilho && r.viajante,
        `${id}: geografia não destravou`, `andarilho=${r.andarilho} viajante=${r.viajante}`);
      checa(m.celulas === esperadas,
        `${id}: portão errado — ${m.celulas} células, esperado ${esperadas}`);
      checa(!m.cru, `${id}: chave de i18n crua na tela (conq.*) — falta tradução`);
      checa(m.colunas.length > 0, `${id}: CONTROLE falhou — não achei a grade pra medir as colunas`);
      checa(new Set(m.colunas).size <= 1,
        `${id}: as colunas saíram desiguais — um nome não cabe e esticou a coluna dele`,
        m.colunas.join('/'));
      checa(m.partidas.length === 0, `${id}: palavra partida no meio`, m.partidas.join(','));
      checa(m.cobertos.length === 0, `${id}: texto coberto`, m.cobertos.join(','));
      checa(m.pequenos.length === 0, `${id}: alvo de toque < 44px`, m.pequenos.join(' | '));
      checa(m.estouroH === 0, `${id}: estouro horizontal`, m.estouroH + 'px');
      for (const [qual, v] of [['trancado', m.cTrancado], ['ganho', m.cGanho]]) {
        checa(v !== null && v >= 4.5, `${id}: contraste ${qual} ${v}:1 (mínimo 4,5)`);
      }
      checa(errosJS.length === 0, `${id}: erro de JS`, errosJS[0]);
      await ctx.close();
    }
  }
}

// ── A PILHA: o próximo pedido por baixo do atual ────────────────────────────
//
// Os guards de `test/pilha.test.mjs` leem FONTE. O que só o navegador responde:
// quem recebe o dedo, quem o Tab alcança, e se o véu de fato pinta. Os três já
// enganaram uma medição minha nesta mesma PR — o véu em z-index:1 pintava atrás
// do conteúdo e as variantes saíam idênticas.
//
// Cada caso leva o CONTROLE junto, e é ele que decide se a medida vale.
{
  const CARDS_PILHA = Object.entries(CARDS).slice(0, 2).map(([, p]) => p);
  // Os QUATRO idiomas, e não só o pt: a string mais larga decide o layout e
  // quase nunca está no idioma em que se desenvolve (gotcha #25). O card de
  // fundo tem o MESMO markup do da frente, então o que se mede aqui é a tela
  // com os dois empilhados — cada aparelho com um tema, e todas as línguas.
  for (const [aparelho, viewport, tema] of [['Pixel 7', { width: 393, height: 852 }, 'light'],
                                            ['Galaxy Fold', { width: 280, height: 653 }, 'dark']]) {
    for (const lang of LINGUAS) {
      const id = `pilha/${aparelho}/${tema}/${lang}`;
      const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', locale: 'pt-BR', colorScheme: tema });
      const page = await ctx.newPage();
      const errosJS = [];
      page.on('pageerror', (e) => errosJS.push(String(e.message || e)));
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(300);

      const montar = (n) => page.evaluate(({ fila, n, lang }) => {
        setLang(lang);
        AppState.authenticated = true;
        AppState.profile = { id: 1, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false };
        AppState.stats = { read: 4, rejected: 2, skipped: 0 };
        AppState.serverTotal = 20; AppState.hasMore = false; AppState.pendingAction = null;
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.remove('hidden');
        renderProfileHeader(AppState.profile); updateStats(); showLoading(false);
        document.getElementById('noMoreCards').classList.add('hidden');
        document.querySelectorAll('.place-card').forEach((e) => e.remove());
        AppState.queue = fila.slice(0, n); AppState.currentPlace = null;
        showCurrentPlace();
        // Direto, sem esperar a foto: o QUANDO é assunto do teste de unidade;
        // aqui o assunto é o que a tela faz com a pilha montada.
        montarCardDeFundo();
      }, { fila: CARDS_PILHA, n, lang });

      // CONTROLE do bloco inteiro: com UM pedido na fila a pilha não existe.
      // Sem ele, um "0 sobreposições" abaixo poderia ser só ausência de card —
      // o guard que passa por AUSÊNCIA do alvo é o erro do gotcha #26.
      await montar(1);
      await assentar(page);
      const so1 = await page.evaluate(() => ({
        cards: document.querySelectorAll('#cardStack .place-card').length,
        fundo: document.querySelectorAll('#cardStack .card-fundo').length,
      }));
      checa(so1.cards === 1 && so1.fundo === 0,
        `${id}: CONTROLE falhou — com um pedido só na fila apareceu pilha`, JSON.stringify(so1));

      await montar(2);
      await assentar(page);
      const m = await page.evaluate(() => {
        const frente = document.querySelector('#cardStack .place-card:not(.card-fundo)');
        const fundo = document.querySelector('#cardStack .card-fundo');
        if (!frente || !fundo) return { faltou: true, n: document.querySelectorAll('.place-card').length };
        const r = frente.getBoundingClientRect();
        // Quem recebe o dedo, em grade 3×3 sobre o card — a mesma amostragem do
        // FAB, porque 5 pontos com cantos recuados deixam faixa cega (gotcha #26).
        const donos = [];
        for (const fx of [0.02, 0.5, 0.98]) for (const fy of [0.02, 0.5, 0.98]) {
          const e = document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy);
          donos.push(!e ? 'nada' : e.closest('.card-fundo') ? 'FUNDO'
            : e.closest('.place-card') ? 'frente' : 'fora');
        }
        const veu = fundo.querySelector('.card-fundo-veu');
        const nome = (c) => (c.querySelector('.card-name') || {}).textContent;
        return {
          nomeFrente: nome(frente), nomeFundo: nome(fundo),
          igualQueue: nome(frente) !== nome(fundo),
          donos, noFundo: donos.filter((d) => d === 'FUNDO').length,
          aria: fundo.getAttribute('aria-hidden'), inert: fundo.inert === true,
          ponteiro: getComputedStyle(fundo).pointerEvents,
          zFrente: +getComputedStyle(frente).zIndex, zFundo: +getComputedStyle(fundo).zIndex,
          veuFundo: veu ? getComputedStyle(veu).backgroundColor : null,
          mesmaCaixa: Math.round(fundo.getBoundingClientRect().width) === Math.round(r.width)
                   && Math.round(fundo.getBoundingClientRect().height) === Math.round(r.height),
        };
      });

      checa(!m.faltou, `${id}: a pilha não montou`, JSON.stringify(m));
      if (!m.faltou) {
        checa(m.igualQueue,
          `${id}: frente e fundo mostram o MESMO pedido — a medida não distingue "revelou o próximo" de "duplicou o atual"`);
        checa(m.noFundo === 0,
          `${id}: o card de fundo recebe o dedo em ${m.noFundo} de 9 pontos — toque ali trata um pedido que não está na tela`,
          m.donos.join(','));
        checa(m.aria === 'true' && m.inert && m.ponteiro === 'none',
          `${id}: o card de fundo não está inerte`, `aria=${m.aria} inert=${m.inert} ponteiro=${m.ponteiro}`);
        checa(m.zFrente > m.zFundo, `${id}: o fundo pinta em cima da frente`, `${m.zFrente} vs ${m.zFundo}`);
        checa(m.mesmaCaixa, `${id}: o card de fundo não ocupa a mesma caixa do da frente`);
        checa(/rgba\(2, 6, 23, 0\.35\)/.test(m.veuFundo || ''),
          `${id}: o véu computado não é o medido`, String(m.veuFundo));
      }

      // O CARD DE FUNDO É A PROMESSA DO QUE VEM — e ela tem que ser cumprida.
      //
      // RELATADO pelo owner com duas capturas do mesmo pedido: puxando o card
      // da frente, o mapa do de baixo tem um tamanho; quando ele chega à
      // frente, tem outro. A causa é o `renderMapa` medir a caixa com
      // `box.clientWidth || 400` — fora do DOM isso é 0 e ele enquadra pra
      // 400×240. Na FRENTE o erro se conserta sozinho (o ResizeObserver de
      // `vigiarCaixaDoMapa` refaz quando a caixa assenta); no FUNDO não,
      // porque `cloneNode` não copia propriedade JS e o observer fica pra trás.
      //
      // Mede o ENQUADRAMENTO (`data-mapa-w/h`), que é o que o mapa foi
      // desenhado pra cobrir, e não só a caixa: as duas caixas sempre bateram
      // — era o desenho dentro delas que divergia.
      // FILA PRÓPRIA, e ela é o cenário do relato: um pedido SEM FOTO, em que
      // o mapa é o PRIMEIRO slide. Com foto o mapa nasce `hidden`, a caixa
      // mede 0 e não há enquadramento a comparar — foi o que o controle abaixo
      // pegou na primeira rodada, com `{f:null,b:null}` nos 8 cenários.
      await page.evaluate(({ base }) => {
        const semFoto = (id) => Object.assign({}, base, {
          venueID: 'map' + id, updateRequestID: 'umap' + id,
          imageUrl: null, imageUrls: [],
          mapa: { centro: [-18.9, -48.27], entradas: [] },
        });
        AppState.queue = [semFoto('A'), semFoto('B')];
        AppState.currentPlace = null;
        document.querySelectorAll('#cardStack .place-card').forEach((e) => e.remove());
        showCurrentPlace();
        montarCardDeFundo();
      }, { base: CARDS_PILHA[0] });
      await assentar(page);

      const mp = await page.evaluate(() => {
        const q = (raiz) => {
          const b = raiz && raiz.querySelector('.card-map');
          if (!b || b.classList.contains('hidden')) return null;
          const t = b.querySelector('.card-map-tiles img');
          return { caixa: Math.round(b.clientWidth) + 'x' + Math.round(b.clientHeight),
                   para: (b.dataset.mapaW || '?') + 'x' + (b.dataset.mapaH || '?'),
                   ro: !!b._roMapa,
                   tile: t ? Math.round(t.getBoundingClientRect().top - b.getBoundingClientRect().top) : null };
        };
        return { f: q(document.querySelector('#cardStack .place-card:not(.card-fundo)')),
                 b: q(document.querySelector('#cardStack .card-fundo')) };
      });
      // CONTROLE do instrumento: sem mapa nos dois, o cenário não mede nada e
      // passaria com o conserto arrancado.
      checa(!!(mp.f && mp.b),
        `${id}: PROMESSA — um dos cards não tem mapa visível, o cenário não mediria nada`,
        JSON.stringify(mp));
      if (mp.f && mp.b) {
        checa(mp.f.para === mp.b.para,
          `${id}: PROMESSA — o mapa do fundo foi desenhado pra ${mp.b.para} e o da frente pra ${mp.f.para}: ele MUDA DE TAMANHO ao virar frente`);
        checa(mp.f.tile === mp.b.tile,
          `${id}: PROMESSA — o tile do fundo está em ${mp.b.tile}px e o da frente em ${mp.f.tile}px`);
        checa(mp.b.ro,
          `${id}: PROMESSA — o card de fundo ficou sem o observer de caixa: o clone não copia propriedade JS e o mapa nunca mais se corrige`);
      }

      // ALCANCE PELO TECLADO — apertando Tab DE VERDADE.
      //
      // A primeira versão disto contava `tabIndex >= 0`, e acusou 6 controles
      // alcançáveis no card de fundo nos 4 aparelhos/temas. Era o instrumento:
      // `inert` tira do passeio do Tab e NÃO mexe no `tabIndex`, que continua 0.
      // Eu estava medindo a intenção do atributo, não o alcance (gotcha #28).
      // O único jeito de saber onde o foco pousa é pousar.
      const passear = async (voltas) => {
        await page.evaluate(() => document.body.focus());
        const visto = [];
        for (let i = 0; i < voltas; i++) {
          await page.keyboard.press('Tab');
          visto.push(await page.evaluate(() => {
            const a = document.activeElement;
            if (!a) return 'nada';
            if (a.closest && a.closest('.card-fundo')) return 'FUNDO';
            if (a.closest && a.closest('#cardStack')) return 'frente';
            return 'fora';
          }));
        }
        return visto;
      };
      const passeio = await passear(24);
      checa(!passeio.includes('FUNDO'),
        `${id}: o Tab pousou no card de fundo — um segundo ✕ ↑ ✓, idêntico ao real, agindo num pedido que não está na tela`,
        passeio.join(','));
      checa(passeio.includes('frente'),
        `${id}: CONTROLE falhou — o Tab não alcançou NENHUM controle do card da frente, então "nunca pousa no fundo" não prova nada`,
        passeio.join(','));
      // CONTRAPROVA: sem o inert o passeio TEM que encontrar o card de fundo.
      // Sem ela, um `inert` que o navegador ignorasse passaria despercebido.
      await page.evaluate(() => {
        const f = document.querySelector('#cardStack .card-fundo');
        f.inert = false; f.removeAttribute('inert');
        f.style.pointerEvents = 'auto';
      });
      const semInert = await passear(24);
      checa(semInert.includes('FUNDO'),
        `${id}: CONTRAPROVA falhou — mesmo SEM inert o Tab não chega ao card de fundo, então o teste acima não estava medindo o inert`,
        semInert.join(','));
      await montar(2); await assentar(page);

      // O VÉU PINTA? Só o pixel responde — e o controle é a mesma tela sem ele.
      const arrastar = () => page.evaluate(() => {
        const f = document.querySelector('#cardStack .place-card:not(.card-fundo)');
        f.style.transition = 'none';
        f.style.transform = 'translateX(-50%) rotate(-9deg)';
      });
      await arrastar();
      await page.waitForTimeout(250);
      const comVeu = await page.screenshot();
      await page.evaluate(() => {
        // impede o aquecimento de refazer o card de fundo COM véu no meio da medida
        window.__mcf = window.__mcf || window.montarCardDeFundo;
        window.montarCardDeFundo = () => {};
        document.querySelectorAll('.card-fundo-veu').forEach((e) => e.remove());
      });
      await page.waitForTimeout(250);
      const semVeu = await page.screenshot();
      checa(Buffer.compare(comVeu, semVeu) !== 0,
        `${id}: tirar o véu não mudou um pixel — ele está pintando atrás do conteúdo do card`);

      // NENHUM ouvinte no card de fundo. O `.click()` programático é de
      // propósito: ele ignora `pointer-events` e `inert`, então mede o OUVINTE
      // e não a camada que o esconde. Antes do clone profundo, a foto do card
      // de fundo ABRIA o lightbox por este caminho.
      // Devolve o `montarCardDeFundo` que o teste do véu stubou pra impedir o
      // aquecimento de refazer o card no meio da captura. Sem esta linha o
      // stub vaza pro teste seguinte e o card de fundo simplesmente não nasce
      // — a sabotagem do instrumento contaminando a medida de depois.
      await page.evaluate(() => { if (window.__mcf) window.montarCardDeFundo = window.__mcf; });
      await montar(2); await assentar(page);
      const ouv = await page.evaluate(() => {
        const b = document.querySelector('#cardStack .card-fundo');
        const f = document.querySelector('#cardStack .place-card:not(.card-fundo)');
        const abriu = () => typeof Lightbox !== 'undefined' && Lightbox.isOpen();
        b.querySelector('.card-image').click();
        const noFundo = abriu(); if (noFundo) Lightbox.close();
        const nx = b.querySelector('.card-image-next');
        const c0 = (b.querySelector('.card-image-count') || {}).textContent;
        if (nx) nx.click();
        const carrossel = (b.querySelector('.card-image-count') || {}).textContent !== c0;
        // CONTROLE: na FRENTE tem que abrir, senão "não abriu no fundo" só diria
        // que o lightbox está quebrado.
        f.querySelector('.card-image').click();
        const naFrente = abriu(); if (naFrente) Lightbox.close();
        return { noFundo, carrossel, naFrente,
                 onerro: typeof b.querySelector('.card-image').onerror === 'function' };
      });
      checa(!ouv.noFundo, `${id}: a foto do card de fundo abriu o lightbox — o ouvinte está vivo e só escondido por outra camada`);
      checa(!ouv.carrossel, `${id}: a seta do carrossel do card de fundo respondeu`);
      checa(ouv.naFrente, `${id}: CONTROLE falhou — a foto do card da FRENTE não abriu o lightbox, então "não abriu no fundo" não prova nada`);
      checa(ouv.onerro, `${id}: o clone comeu o onerror da foto — foto 404 no fundo vira caixa vazia em vez do "Sem Imagem"`);

      checa(errosJS.length === 0, `${id}: erro de JS`, errosJS[0]);
      await ctx.close();
    }
  }
}

// ── DESFAZER ATÉ O FIM ──────────────────────────────────────────────────────
//
// Existe porque um defeito passou por aqui e foi pra PRODUÇÃO: em #215 as
// funções `registrarAcaoConfirmada` e `registrarDesfazer` foram removidas por
// engano e os três call sites ficaram. `desfazerAcaoPendente` lançava ANTES de
// tirar o banner e reabilitar os botões — desfazer devolvia o pedido e deixava
// o card MORTO (banner preso, ✕ ↑ ✓ desabilitados), e só recarregando saía
// disso. O GESTO continuava funcionando, que é o que escondeu: exatamente a
// assinatura do gotcha #63.
//
// Nada enxergava. `node --check` não pega erro de execução; os testes de
// unidade FATIAM a fonte em vez de rodá-la; e o smoke exercitava o Desfazer só
// até o banner ABRIR. Este bloco vai até o fim: aperta, e confere que a tela
// VOLTA ao que era.
{
  const id = 'desfazer/Pixel 7';
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 },
    serviceWorkers: 'block', locale: 'pt-BR' });
  const page = await ctx.newPage();
  const errosJS = [];
  page.on('pageerror', (e) => errosJS.push(String(e.message || e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  const CARDS_UNDO = Object.entries(CARDS).slice(0, 3).map(([, p]) => p);
  await page.evaluate(({ fila }) => {
    AppState.authenticated = true;
    AppState.profile = { id: 1, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false };
    AppState.stats = { read: 4, rejected: 2, skipped: 0 };
    AppState.serverTotal = fila.length; AppState.hasMore = false;
    AppState.preferences.undoEnabled = true;
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    renderProfileHeader(AppState.profile); updateStats(); showLoading(false);
    document.getElementById('noMoreCards').classList.add('hidden');
    document.querySelectorAll('.place-card').forEach((e) => e.remove());
    AppState.queue = fila.slice(); AppState.currentPlace = null; showCurrentPlace();
  }, { fila: CARDS_UNDO });
  await assentar(page);

  const tela = () => page.evaluate(() => {
    const f = document.querySelector('#cardStack .place-card:not(.card-fundo)');
    const b = f && f.querySelector('.card-btn-reject');
    return { pedido: f && (f.querySelector('.card-name') || {}).textContent,
             botao: b ? (b.disabled ? 'desabilitado' : 'ok') : 'sem card',
             banner: (document.getElementById('undoContainer') || {}).innerHTML ? 'na tela' : 'limpo',
             fila: AppState.queue.length };
  });

  const antes = await tela();
  await page.evaluate(() => document.querySelector('.place-card:not(.card-fundo) .card-btn-reject').click());
  await page.waitForTimeout(600);
  const durante = await tela();
  // CONTROLE: sem a janela aberta do jeito certo, o que vem depois não prova nada.
  checa(durante.banner === 'na tela' && durante.botao === 'desabilitado' && durante.fila === antes.fila - 1,
    `${id}: CONTROLE falhou — a janela do Desfazer não abriu como se espera`, JSON.stringify(durante));

  const clicou = await page.evaluate(() => {
    const b = document.querySelector('#undoContainer button');
    if (!b) return false;
    b.click();
    return true;
  });
  checa(clicou, `${id}: o banner do Desfazer não tem botão`);
  await page.waitForTimeout(700);
  const depois = await tela();
  checa(depois.pedido === antes.pedido, `${id}: o Desfazer não devolveu o pedido`,
    `${antes.pedido} → ${depois.pedido}`);
  checa(depois.fila === antes.fila, `${id}: a fila não voltou`, `${antes.fila} → ${depois.fila}`);
  checa(depois.banner === 'limpo', `${id}: o banner do Desfazer ficou PRESO na tela depois de apertado`);
  checa(depois.botao === 'ok',
    `${id}: os botões ✕ ↑ ✓ continuaram DESABILITADOS depois do Desfazer — o card volta morto e só recarregando sai disso`);
  checa(errosJS.length === 0, `${id}: erro de JS no caminho do Desfazer`, errosJS[0]);
  await ctx.close();
}

// ── ENTRADA DO CARD: nenhum efeito, e nada escondido ───────────────────────
//
// Decisão do owner (2026-09-20), em duas rodadas: primeiro "o próximo card não
// pode nascer com efeito nenhum" (saíram a mola e a escala), depois "pode tirar
// o fade". Hoje o card aparece pronto — no lugar, do tamanho final e opaco.
//
// Os guards de `test/pilha.test.mjs` leem o CSS e o JS: eles provam que a
// classe da entrada não existe mais. O que SÓ o navegador responde é se a tela
// concorda — se o card de fato não se mexe, não muda de tamanho e não fica
// translúcido, e se o card de fundo continua visível o tempo todo.
//
// Era UMA animação (o fade) que causava UM defeito (o card de baixo aparecendo
// através do da frente: 3 quadros com a foto do pedido errado e os dois nomes
// legíveis ao mesmo tempo) e exigia UM remendo (esconder o de fundo enquanto o
// fade durava). Tirando a animação, os três somem — e é o conjunto que se mede
// aqui, porque reintroduzir o efeito reintroduz o par inteiro.
//
// A CONTRAPROVA no fim é o que dá valor ao resto: "opacidade sempre 1" e
// "nunca escondeu" são asserções que um instrumento CEGO satisfaz sozinho
// (gotcha #28). Ela injeta o fade e o esconderijo de volta e exige que a
// medição os VEJA.
{
  const medir = (page) => page.evaluate(async () => {
    const frente = () => document.querySelector('#cardStack .place-card:not(.card-fundo)');
    const out = []; const t0 = performance.now();
    document.querySelector('.card-btn-reject').click();
    await new Promise((ok) => {
      const passo = () => {
        const c = frente();
        if (c) {
          const b = c.getBoundingClientRect();
          const f = document.querySelector('#cardStack .card-fundo');
          out.push({ ms: Math.round(performance.now() - t0), top: b.top, w: b.width,
                     op: +getComputedStyle(c).opacity,
                     fundo: f ? getComputedStyle(f).visibility : 'sem fundo' });
        }
        if (performance.now() - t0 < 1400) requestAnimationFrame(passo); else ok();
      };
      requestAnimationFrame(passo);
    });
    // só o card NOVO: o antigo sai por volta dos 370ms
    const s = out.filter((x) => x.ms >= 372);
    const fim = s[s.length - 1];
    if (!fim) return { n: 0 };
    return {
      n: s.length,
      moveu: +Math.max(...s.map((x) => Math.abs(x.top - fim.top))).toFixed(1),
      tamanho: +(Math.max(...s.map((x) => x.w)) - Math.min(...s.map((x) => x.w))).toFixed(1),
      opMin: +Math.min(...s.map((x) => x.op)).toFixed(2),
      escondeu: s.some((x) => x.fundo === 'hidden'),
      // CONTROLE: "nunca escondeu" é satisfeito de graça quando não há card de
      // fundo nenhum. Sem esta linha a asserção passa sozinha.
      temFundo: s.some((x) => x.fundo !== 'sem fundo'),
      fundoNoFim: fim.fundo,
    };
  });

  for (const reduzida of [false, true]) {
    const id = `entrada/${reduzida ? 'reduced-motion' : 'movimento normal'}`;
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 },
      serviceWorkers: 'block', locale: 'pt-BR',
      reducedMotion: reduzida ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage();
    const errosJS = [];
    page.on('pageerror', (e) => errosJS.push(String(e.message || e)));
    await page.route('**/api/**', (r) => r.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify({ success: true }) }));
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    // CINCO e não três: a medição gasta um pedido e a CONTRAPROVA gasta outro,
    // e no último da fila o app não monta pilha (de propósito — desenhar o
    // "Tudo limpo!" por baixo anunciaria o fim antes da hora). Com três, a
    // contraprova rodava sem card de fundo nenhum e "nunca escondeu" passava
    // por não haver o que esconder. Foi a própria contraprova que pegou isso.
    const CARDS_ENT = Object.entries(CARDS).slice(0, 5).map(([, p]) => p);
    await page.evaluate(({ fila }) => {
      localStorage.setItem('waze_session_token', 't');
      // `API` é `const` do api.js: NÃO mora no `window` (o `window.API &&` deixava a linha morta). Desde o
      // R13-1-04 as rotas mandam a sessão da MEMÓRIA, sem adotar a do aparelho: sem o `setSession`, o ✕ voltava
      // "sem sessão", a sessão caía e o bloco seguinte media a tela de entrada (o WebKit, mais lento, pegava isso).
      if (typeof API !== 'undefined' && API.setSession) API.setSession('t', 'cookies');
      AppState.authenticated = true;
      // Desfazer DESLIGADO de verdade: a preferência sozinha não basta, o
      // canDisableUndo() também exige a cota.
      AppState.stats = { read: 200, rejected: 200, skipped: 0 };
      AppState.preferences = Object.assign({}, AppState.preferences,
        { undoEnabled: false, undoGateSeen: true, dicaDesfazerVista: true });
      AppState.profile = { id: 1, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false };
      AppState.serverTotal = fila.length; AppState.hasMore = false;
      document.getElementById('authScreen').classList.add('hidden');
      document.getElementById('appScreen').classList.remove('hidden');
      renderProfileHeader(AppState.profile); updateStats(); showLoading(false);
      document.getElementById('noMoreCards').classList.add('hidden');
      document.querySelectorAll('.place-card').forEach((e) => e.remove());
      AppState.queue = fila.slice(); AppState.currentPlace = null; showCurrentPlace();
    }, { fila: CARDS_ENT });
    await assentar(page);

    const m = await medir(page);

    checa(m.n > 5, `${id}: CONTROLE falhou — quase nenhuma amostra do card novo, o resto não prova nada`, JSON.stringify(m));
    checa(m.moveu === 0, `${id}: o card NOVO se moveu ${m.moveu}px ao entrar — ele tem que nascer no lugar`);
    checa(m.tamanho === 0, `${id}: o card NOVO mudou de tamanho ${m.tamanho}px ao entrar — foi exatamente isto que o owner pediu pra tirar`);
    checa(m.opMin === 1, `${id}: o card NOVO nasceu translúcido (opacidade mínima ${m.opMin}) — voltou efeito na entrada, e com ele o card de baixo atravessando o da frente`);
    checa(m.temFundo, `${id}: CONTROLE falhou — não havia card de fundo em quadro nenhum, então tudo que se diga sobre ele abaixo passa de graça`, JSON.stringify(m));
    checa(!m.escondeu, `${id}: o card de fundo foi ESCONDIDO em algum quadro — sem efeito na entrada não há nada pra esconder, e esconder à toa é a pilha piscando`);
    checa(m.fundoNoFim === 'visible',
      `${id}: o card de fundo não terminou VISÍVEL (${m.fundoNoFim}) — a pilha some do app`);

    // CONTRAPROVA, uma vez só: sem ela, "opacidade sempre 1" e "nunca
    // escondeu" passariam com a medição apontando pro lugar errado.
    if (!reduzida) {
      await page.evaluate(() => {
        const st = document.createElement('style');
        st.textContent = '@keyframes __provaFade{from{opacity:0}to{opacity:1}}'
          + '#cardStack .place-card:not(.card-fundo){animation:__provaFade .3s linear}'
          + '#cardStack .place-card:not(.card-fundo) ~ .card-fundo{visibility:hidden}';
        document.head.appendChild(st);
      });
      await assentar(page);
      const sab = await medir(page);
      checa(sab.n > 5, `${id}: CONTRAPROVA sem amostras — ela não prova nada`, JSON.stringify(sab));
      checa(sab.temFundo, `${id}: CONTRAPROVA sem card de fundo — o esconderijo injetado não teria o que esconder, e o "não viu" abaixo seria do cenário, não da medição`, JSON.stringify(sab));
      checa(sab.opMin < 1,
        `${id}: CONTRAPROVA falhou — com um fade injetado de propósito a medição ainda leu opacidade ${sab.opMin}, então "sem fade" acima não estava medindo fade nenhum`);
      checa(sab.escondeu,
        `${id}: CONTRAPROVA falhou — com o esconderijo injetado de propósito a medição não viu o card de fundo sumir, então "nunca escondeu" acima não provava nada`);
    }
    checa(errosJS.length === 0, `${id}: erro de JS`, errosJS[0]);
    await ctx.close();
  }
}

// ── O PONTO LEVA AO QUE DESTRAVOU ──────────────────────────────────────────
//
// O owner apontou a incoerência olhando o app: o aviso do Desfazer te leva ao
// interruptor com destaque, e o ponto da conquista te largava na aba Filtros
// pra procurar entre 16 células.
//
// Os guards de `test/patentes.test.mjs` leem a FONTE — que a condição tem fonte
// única, que a ordem está certa, que o alvo cobre os dois casos. O que só o
// navegador responde é se a tela concorda, e em particular UMA coisa que não se
// lê de código nenhum: **em que quadro** a aba troca. O `openFiltersModal`
// termina numa chamada de rede, e esperar por ela deixaria o editor olhando a
// aba Filtros por até 1337ms antes de a tela saltar. Por isso a rede LENTA é um
// cenário aqui, e não uma nota de rodapé.
{
  const CENARIOS = [
    // Rede boa e rede LENTA medem a MESMA coisa de propósito: a segunda é a que
    // denuncia um `await` no lugar errado, e a primeira é o controle dela.
    { id: 'conquista/rede boa',  novas: ['maoFirme'], patente: false, lento: 0,    reduzida: false, desvia: true },
    { id: 'conquista/rede 1,4s', novas: ['maoFirme'], patente: false, lento: 1400, reduzida: false, desvia: true },
    { id: 'conquista/três',      novas: ['maoFirme', 'coruja', 'detetive'], patente: false, lento: 0, reduzida: false, desvia: true },
    { id: 'conquista/só patente', novas: [],          patente: true,  lento: 0,    reduzida: false, desvia: true },
    { id: 'conquista/reduced',   novas: ['maoFirme'], patente: false, lento: 0,    reduzida: true,  desvia: true },
    // CONTROLE: sem novidade o botão tem que fazer o que promete. Sem ele,
    // "foi pro Histórico" passaria mesmo se o desvio fosse incondicional — que
    // é justamente o defeito de sequestrar o botão pra sempre.
    { id: 'conquista/CONTROLE sem novidade', novas: [], patente: false, lento: 0, reduzida: false, desvia: false },
  ];

  for (const c of CENARIOS) {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 },
      serviceWorkers: 'block', locale: 'pt-BR',
      reducedMotion: c.reduzida ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage();
    const errosJS = [];
    page.on('pageerror', (e) => errosJS.push(String(e.message || e)));
    await page.route('**/api/**', async (r) => {
      if (c.lento) await dormir(c.lento);
      r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, countries: [{ id: 30, name: 'Brazil' }] }) });
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ novas, patente }) => {
      localStorage.setItem('waze_session_token', 't');
      // `tudoLimpo` entra como JÁ GANHA de propósito: a API deste bloco devolve
      // fila vazia, o que destrava "Tudo limpo!" de verdade e reacende o ponto
      // no meio da medição. Aconteceu, e por 20 minutos pareceu defeito do
      // recurso (gotcha #28 — a fixture produzindo o achado).
      const g = { primeiraFaxina: '2026-09-01', centuriao: '2026-09-05', tudoLimpo: '2026-09-06' };
      for (const id of novas) g[id] = '2026-09-20';
      localStorage.setItem('waze_places_conquistas', JSON.stringify({ c: g, seq: 1,
        patente: 2, n: {}, langs: ['pt'], base: true, novas, patenteNova: patente }));
    }, { novas: c.novas, patente: c.patente });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      // `API` é `const` do api.js: NÃO mora no `window` (o `window.API &&` deixava a linha morta). Desde o
      // R13-1-04 as rotas mandam a sessão da MEMÓRIA, sem adotar a do aparelho: sem o `setSession`, o ✕ voltava
      // "sem sessão", a sessão caía e o bloco seguinte media a tela de entrada (o WebKit, mais lento, pegava isso).
      if (typeof API !== 'undefined' && API.setSession) API.setSession('t', 'cookies');
      AppState.authenticated = true;
      AppState.profile = { id: 1, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false };
      AppState.stats = { read: 100, rejected: 50, skipped: 0 };
      AppState.serverTotal = 10; AppState.hasMore = false;
      AppState.countries = []; AppState.statesByCountry = {};
      document.getElementById('authScreen').classList.add('hidden');
      document.getElementById('appScreen').classList.remove('hidden');
      renderProfileHeader(AppState.profile); updateStats(); showLoading(false);
      atualizarSeloDeConquista();
    });
    await page.waitForTimeout(150);

    const aba = () => page.evaluate(() => ['filtersTabFilters', 'filtersTabPrefs', 'filtersTabHistory']
      .find((id) => document.getElementById(id).getAttribute('aria-selected') === 'true'));
    const pontoAceso = () => page.evaluate(() =>
      !document.getElementById('conqSelo').classList.contains('hidden'));

    checa(await pontoAceso() === c.desvia,
      `${c.id}: CONTROLE falhou — o ponto não está no estado esperado antes do toque, então nada abaixo prova nada`);

    // CLIQUE de verdade no botão, não a função chamada à mão: o que está em
    // jogo é o ROTEAMENTO, e chamar a função pula exatamente a parte medida.
    await page.evaluate(() => document.getElementById('filtersBtn').click());
    // No PRIMEIRO quadro: é aqui que um `await` no lugar errado apareceria.
    const q1 = await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => ok({
      aba: ['filtersTabFilters', 'filtersTabPrefs', 'filtersTabHistory']
        .find((id) => document.getElementById(id).getAttribute('aria-selected') === 'true'),
      modal: !document.getElementById('filtersModal').classList.contains('hidden'),
      marcados: document.querySelectorAll('#filtersPanelHistory .conq-cel.nova, #filtersPanelHistory .conq-card.nova').length,
      pulsando: document.querySelectorAll('.conq-alvo').length,
    }))));

    checa(q1.modal, `${c.id}: o modal não abriu no primeiro quadro`);
    if (c.desvia) {
      checa(q1.aba === 'filtersTabHistory',
        `${c.id}: no primeiro quadro a aba era ${q1.aba} — com rede lenta isso é o editor olhando a aba errada por mais de um segundo antes de a tela saltar`);
      checa(q1.marcados >= 1,
        `${c.id}: nenhuma marca no painel — a troca de aba apagou as novas ANTES do render, e a pessoa chega numa vitrine sem nada destacado`);
      checa(c.reduzida ? q1.pulsando === 0 : q1.pulsando === q1.marcados,
        `${c.id}: pulso em ${q1.pulsando} de ${q1.marcados} marcados (reduced-motion: ${c.reduzida})`);
      // o alvo precisa estar VISÍVEL dentro do painel, não só existir
      const naTela = await page.evaluate(() => {
        const alvo = document.querySelector('#filtersPanelHistory .conq-card.nova, #filtersPanelHistory .conq-cel.nova');
        const pain = document.getElementById('filtersPanelHistory');
        if (!alvo || !pain) return null;
        const r = alvo.getBoundingClientRect(), p = pain.getBoundingClientRect();
        return r.top >= p.top - 1 && r.bottom <= p.bottom + 1;
      });
      checa(naTela === true, `${c.id}: o alvo ficou FORA da área visível do painel — destacar o que não está na tela não aponta nada`);
      checa(await pontoAceso() === false,
        `${c.id}: o ponto continuou aceso depois de a aba abrir`);
    } else {
      checa(q1.aba === 'filtersTabFilters',
        `${c.id}: sem novidade nenhuma o botão desviou assim mesmo — aí ele sequestra Filtros pra sempre`);
    }

    // Segunda abertura: tem que voltar a ser o botão de Filtros de sempre.
    await page.evaluate(() => closeModal('filtersModal'));
    await page.waitForTimeout(250);
    await page.evaluate(() => document.getElementById('filtersBtn').click());
    await page.waitForTimeout(c.lento ? c.lento + 300 : 350);
    checa(await aba() === 'filtersTabFilters',
      `${c.id}: a SEGUNDA abertura ainda desvia — o desvio tem que valer uma vez por conquista`);

    checa(errosJS.length === 0, `${c.id}: erro de JS`, errosJS[0]);
    await ctx.close();
  }
}

// ── OS AVISOS DE UMA VEZ SÓ SAEM ONDE A PESSOA OS VÊ (R13-7-01) ─────────────
// A consequência do 1º ✕ e do 1º ✓, o desbloqueio do Desfazer e a dica "você
// nunca desfaz" aparecem UMA vez na vida, no banner do topo (z-55) — abaixo dos
// modais (z-60) e da foto ampliada (z-65). A decisão que pousava com os Filtros
// ou a Ajuda abertos (abertos na janela do Desfazer, o caso comum) punha o banner
// inteiro debaixo da caixa da camada, e a marca de visto o gastava; com a página
// no fundo, ele saía e sumia antes de a pessoa voltar. Agora ele espera: a camada
// fechar, a página voltar. Pelo `initApp` de verdade, com a API de mentira, e o
// banner medido por hit-test em grade 3×3 (gotcha #26). CONTROLES: sem camada o
// banner sai no pouso e recebe o toque; e a mesma grade, com os Filtros abertos
// POR CIMA de um banner na tela, vê o banner coberto — sem isso, "nada cobre"
// passaria com a grade cega.
{
  const PERFIL_L6 = { id: 12444348, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false, editableCountryIDs: [30], areas: [] };
  const hoje = new Date();
  const dia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  const pedido = (n) => ({ venueID: 'av' + n, updateRequestID: 'u' + n, name: 'Local ' + n, categories: ['PARK'],
    address: 'Rua ' + n + ', 1', updateTypeKey: 'VENUE', purType: 'NEW_PLACE', createdBy: 'fulano' + n, creatorId: 900 + n,
    creatorRank: 0, lat: -12.9, lon: -38.3, changes: [], mapa: null, localAprovado: true, dateAdded: Date.now() - 3600000 * n, imageUrls: [] });
  const PREFS = {
    consequencia: { undoEnabled: true, comoFuncionaVisto: true, undoGateSeen: true, dicaDesfazerVista: true },
    desbloqueio: { undoEnabled: true, comoFuncionaVisto: true, undoGateSeen: false, dicaDesfazerVista: false,
      consequenciaVista: { read: true, reject: true } },
    dica: { undoEnabled: true, comoFuncionaVisto: true, undoGateSeen: true, dicaDesfazerVista: false, semUndoSeguidas: 19,
      consequenciaVista: { read: true, reject: true } },
  };
  // `segurarLido`: o ✓ fica no ar até o teste soltar — a página vai pro fundo ANTES de ele pousar.
  const abrirApp = async ({ viewport, aviso, segurarLido = false }) => {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', locale: 'pt-BR' });
    const n0 = aviso === 'desbloqueio' ? 9 : 50;
    await ctx.addInitScript(({ prefs, n0, dia }) => {
      try {
        if (sessionStorage.getItem('__avisosUmaVez')) return;
        sessionStorage.setItem('__avisosUmaVez', '1');
        localStorage.setItem('waze_session_token', 'token-smoke');
        localStorage.setItem('waze_places_lang', 'pt');
        localStorage.setItem('waze_places_preferences', JSON.stringify(prefs));
        localStorage.setItem('waze_places_stats', JSON.stringify({ read: n0, rejected: 0, skipped: 0 }));
        localStorage.setItem('waze_places_history', JSON.stringify({ _total: { read: n0, rejected: 0 }, [dia]: { read: n0, rejected: 0 } }));
      } catch (e) { /* armazenamento bloqueado: o teste segue */ }
    }, { prefs: PREFS[aviso], n0, dia });
    const places = [1, 2, 3, 4].map(pedido);
    let soltar = null;
    const lido = segurarLido ? new Promise((ok) => { soltar = ok; }) : null;
    const envios = [];
    await ctx.route('**/api/**', async (r) => {
      const nome = r.request().url().split('/api/')[1].split(/[?#]/)[0];
      let corpo = { success: true };
      if (nome === 'perfil' || nome === 'testar-cookies') corpo = { success: true, visivelNoWme: true, referencias: null, profile: PERFIL_L6 };
      else if (nome === 'lista-paises') corpo = { success: true, countries: [{ id: 30, name: 'Brazil', abbr: 'BR', env: 'row' }] };
      else if (nome === 'lista-estados') corpo = { success: true, states: [] };
      else if (nome === 'presenca-app') corpo = { success: true, online: [], conversas: [] };
      else if (nome === 'buscar-places') corpo = { success: true, places, hasMore: false, page: 1, total: places.length, totalAll: places.length, blocked: 0 };
      else if (nome === 'validar-place' || nome === 'marcar-lido') {
        envios.push(nome);
        if (nome === 'marcar-lido' && lido) await lido;
      }
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) }).catch(() => {});
    });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e.message || e)));
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await esperarOuExplodir(page, () => !!(window.AppState && AppState.authenticated && AppState.profile && AppState.currentPlace
      && document.querySelector('#cardStack .place-card:not(.card-fundo)')), `avisos de uma vez (${aviso}): o app não abriu o 1º card`);
    await doisQuadros(page);
    return { ctx, page, erros, envios, soltar: () => soltar && soltar() };
  };
  // O banner do topo: o texto e quantos dos 9 pontos (grade 3×3, fora dos cantos
  // arredondados) o recebem — medido com ele ASSENTADO (ele entra deslizando).
  const banner = async (page) => { await assentar(page); return page.evaluate(() => {
    const b = document.querySelector('#bannerContainer .toast');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    let recebe = 0;
    for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.2, 0.5, 0.8]) {
      const h = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
      if (h && b.contains(h)) recebe++;
    }
    return { texto: b.textContent.trim().slice(0, 40), recebe };
  }); };
  const marcas = (page) => page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('waze_places_preferences') || '{}');
    return { reject: !!(p.consequenciaVista && p.consequenciaVista.reject), gate: p.undoGateSeen === true, dica: p.dicaDesfazerVista === true };
  });
  // POUSOU: o envio CHEGOU à API (contado no Node) e a resposta foi processada.
  // Só o estado da página não serve: logo depois do toque, antes de a janela
  // abrir (a animação do card), ele já diz "nada no ar".
  const pousou = async (page, envios, n) => {
    const t0 = Date.now();
    while (envios.length < n) {
      if (Date.now() - t0 > 15000) throw new Error(`avisos de uma vez: ${envios.length} envio(s) em 15 s, esperava ${n}`);
      await dormir(50);
    }
    await esperarOuExplodir(page, () => !AppState.pendingAction && AppState.inFlightActions === 0, 'avisos de uma vez: a decisão não pousou', 15000);
  };
  const esconder = (page, oculta) => page.evaluate((oculta) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (oculta ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => oculta });
    document.dispatchEvent(new Event('visibilitychange'));
  }, oculta);
  const FRENTE = '#cardStack .place-card:not(.card-fundo)';
  const PIXEL = { width: 412, height: 915 };
  const SE = { width: 320, height: 568 };

  // (1) A consequência do 1º ✕ com os Filtros abertos na janela: espera, e sai ao fechá-los.
  {
    const { ctx, page, erros, envios } = await abrirApp({ viewport: PIXEL, aviso: 'consequencia' });
    await page.click(FRENTE + ' .card-btn-reject');
    await esperarOuExplodir(page, () => !!AppState.pendingAction, 'avisos de uma vez (1): o ✕ não abriu a janela');
    await page.click('#filtersBtn');
    await esperarOuExplodir(page, () => (topOpenModal() || {}).id === 'filtersModal', 'avisos de uma vez (1): os Filtros não abriram');
    await pousou(page, envios, 1);
    await doisQuadros(page);
    checa(await banner(page) === null, 'avisos de uma vez (1): a consequência do 1º ✕ saiu POR BAIXO dos Filtros', JSON.stringify(await banner(page)));
    checa(!(await marcas(page)).reject, 'avisos de uma vez (1): a consequência do 1º ✕ ficou GASTA debaixo dos Filtros — nunca mais aparece');
    await page.keyboard.press('Escape');
    const veio = await esperarNaPagina(page, () => !topOpenModal() && !!document.querySelector('#bannerContainer .toast'), 5000, 50);
    checa(veio.ok, 'avisos de uma vez (1): os Filtros fecharam e a consequência que esperava não apareceu');
    const b = await banner(page);
    checa(!!b && b.recebe === 9, 'avisos de uma vez (1): o banner que esperava não recebe o toque inteiro', JSON.stringify(b));
    checa((await marcas(page)).reject, 'avisos de uma vez (1): o banner apareceu e não ficou marcado (sairia de novo)');
    checa(erros.length === 0, 'avisos de uma vez (1): erro de JS', erros[0]);
    await ctx.close();
  }
  // CONTROLE: sem camada, o banner sai no pouso — e a MESMA grade, com os
  // Filtros abertos por cima dele, o vê coberto.
  {
    const { ctx, page, erros, envios } = await abrirApp({ viewport: PIXEL, aviso: 'consequencia' });
    await page.click(FRENTE + ' .card-btn-reject');
    await pousou(page, envios, 1);
    await doisQuadros(page);
    const b = await banner(page);
    checa(!!b && b.recebe === 9, 'avisos de uma vez (CONTROLE): sem camada, a consequência não saiu no pouso, ou não recebe o toque', JSON.stringify(b));
    checa((await marcas(page)).reject, 'avisos de uma vez (CONTROLE): a consequência saiu e não ficou marcada');
    await page.evaluate(() => openFiltersModal());
    await doisQuadros(page);
    const coberto = await banner(page);
    checa(!!coberto && coberto.recebe === 0, 'avisos de uma vez (CONTROLE): com os Filtros por cima, a grade ainda vê o banner — ela está cega',
      JSON.stringify(coberto));
    checa(erros.length === 0, 'avisos de uma vez (CONTROLE): erro de JS', erros[0]);
    await ctx.close();
  }
  // (2) O desbloqueio do Desfazer que pousa com a página no FUNDO: espera a volta.
  // E o CONTROLE à vista, com o mesmo ✓ segurado.
  for (const fundo of [true, false]) {
    const rot = `avisos de uma vez (2, ${fundo ? 'no fundo' : 'CONTROLE à vista'})`;
    const { ctx, page, erros, envios, soltar } = await abrirApp({ viewport: PIXEL, aviso: 'desbloqueio', segurarLido: true });
    await page.click(FRENTE + ' .card-btn-read');
    await esperarOuExplodir(page, () => !AppState.pendingAction && AppState.inFlightActions === 1, `${rot}: o ✓ não saiu no fim da janela`, 10000);
    if (fundo) await esconder(page, true);
    soltar();
    await pousou(page, envios, 1);
    await doisQuadros(page);
    const noPouso = await banner(page);
    if (fundo) {
      checa(noPouso === null, `${rot}: o desbloqueio saiu com a página escondida — some antes de a pessoa voltar`, JSON.stringify(noPouso));
      checa(!(await marcas(page)).gate, `${rot}: o desbloqueio (uma vez na vida) ficou GASTO com a página escondida`);
      await esconder(page, false);
      const veio = await esperarNaPagina(page, () => !!document.querySelector('#bannerContainer .toast'), 5000, 50);
      checa(veio.ok, `${rot}: a página voltou e o desbloqueio que esperava não apareceu`);
    } else {
      checa(!!noPouso, `${rot}: à vista, o desbloqueio não saiu no pouso`);
    }
    const b = await banner(page);
    checa(!!b && b.recebe === 9, `${rot}: o banner do desbloqueio não recebe o toque inteiro`, JSON.stringify(b));
    checa((await marcas(page)).gate, `${rot}: o desbloqueio apareceu e não ficou marcado`);
    checa(erros.length === 0, `${rot}: erro de JS`, erros[0]);
    await ctx.close();
  }
  // (3) A dica "você nunca desfaz" no iPhone SE de 2016: a 20ª janela vence
  // sozinha com a Ajuda aberta — espera ela fechar, pelo ✕ dela.
  {
    const { ctx, page, erros, envios } = await abrirApp({ viewport: SE, aviso: 'dica' });
    await page.click(FRENTE + ' .card-btn-reject');
    await esperarOuExplodir(page, () => !!AppState.pendingAction, 'avisos de uma vez (3): o ✕ não abriu a janela');
    await page.click('#helpBtn');
    await esperarOuExplodir(page, () => (topOpenModal() || {}).id === 'helpModal', 'avisos de uma vez (3): a Ajuda não abriu');
    await pousou(page, envios, 1);
    await doisQuadros(page);
    checa(await banner(page) === null, 'avisos de uma vez (3): a dica saiu POR BAIXO da Ajuda', JSON.stringify(await banner(page)));
    checa(!(await marcas(page)).dica, 'avisos de uma vez (3): a dica ficou GASTA debaixo da Ajuda');
    await page.click('#closeHelp');
    const veio = await esperarNaPagina(page, () => !topOpenModal() && !!document.querySelector('#bannerContainer .toast'), 5000, 50);
    checa(veio.ok, 'avisos de uma vez (3): a Ajuda fechou e a dica que esperava não apareceu');
    const b = await banner(page);
    checa(!!b && b.recebe === 9, 'avisos de uma vez (3): o banner da dica não recebe o toque inteiro', JSON.stringify(b));
    checa((await marcas(page)).dica, 'avisos de uma vez (3): a dica apareceu e não ficou marcada');
    checa(erros.length === 0, 'avisos de uma vez (3): erro de JS', erros[0]);
    await ctx.close();
  }
  // (4) R14-7-A1: o aviso que esperava a Ajuda fechar e que o TREINO segurou (o
  // "Praticar" fecha a Ajuda e abre o treino no mesmo tique) sai quando o treino
  // acaba — pelo "Sair" da faixa e pelo ↻, e não só pelo "Ir para a fila", que
  // fecha uma camada. Antes, ele esperava a PRÓXIMA camada fechar (os Filtros,
  // fora de contexto). A grade e a marca de visto são as de cima.
  for (const fim of ['faixa', 'atualizar']) {
    const rot = `avisos de uma vez (4, treino e ${fim === 'faixa' ? 'o "Sair" da faixa' : 'o ↻'})`;
    const { ctx, page, erros, envios } = await abrirApp({ viewport: PIXEL, aviso: 'consequencia' });
    await page.click(FRENTE + ' .card-btn-reject');
    await esperarOuExplodir(page, () => !!AppState.pendingAction, `${rot}: o ✕ não abriu a janela`);
    await page.click('#helpBtn');
    await esperarOuExplodir(page, () => (topOpenModal() || {}).id === 'helpModal', `${rot}: a Ajuda não abriu`);
    await pousou(page, envios, 1);
    await doisQuadros(page);
    checa(await banner(page) === null, `${rot}: PRÉ-CONDIÇÃO — a consequência saiu por baixo da Ajuda`);
    await page.click('#abrirTreino');
    await esperarOuExplodir(page, () => Treino.ativo === true && !topOpenModal(), `${rot}: o "Praticar" não abriu o treino`);
    await doisQuadros(page);
    checa(await banner(page) === null, `${rot}: a consequência da fila real saiu por cima do TREINO`, JSON.stringify(await banner(page)));
    checa(!(await marcas(page)).reject, `${rot}: a consequência ficou gasta no treino`);
    await page.click(fim === 'faixa' ? '#treinoSairBtn' : '#refreshBtn');
    const veio = await esperarNaPagina(page, () => Treino.ativo === false && !!document.querySelector('#bannerContainer .toast'), 5000, 50);
    checa(veio.ok, `${rot}: o treino acabou e a consequência que ele segurou não saiu — ela esperava a PRÓXIMA camada fechar`);
    const b = await banner(page);
    checa(!!b && b.recebe === 9, `${rot}: o banner que o treino segurou não recebe o toque inteiro`, JSON.stringify(b));
    checa((await marcas(page)).reject, `${rot}: o banner apareceu e não ficou marcado`);
    checa(erros.length === 0, `${rot}: erro de JS`, erros[0]);
    await ctx.close();
  }
  // (5) R14-7-A5: o aviso que JÁ está na tela quando o treino abre sai dele (não
  // fica sobre o card de treino e a faixa "nada é enviado ao Waze") e VOLTA,
  // inteiro, no "Sair" do treino — decisão do owner. CONTROLE: o aviso que a
  // pessoa já dispensou (o toque nele) não volta.
  for (const dispensado of [false, true]) {
    const rot = `avisos de uma vez (5, ${dispensado ? 'CONTROLE dispensado antes' : 'na tela quando o treino abre'})`;
    const { ctx, page, erros, envios } = await abrirApp({ viewport: PIXEL, aviso: 'consequencia' });
    await page.click(FRENTE + ' .card-btn-reject');
    await pousou(page, envios, 1);
    await doisQuadros(page);
    const antes = await banner(page);
    checa(!!antes && antes.recebe === 9, `${rot}: PRÉ-CONDIÇÃO — sem camada, a consequência não saiu no pouso`, JSON.stringify(antes));
    if (dispensado) {
      await page.click('#bannerContainer .toast');
      await esperarOuExplodir(page, () => !document.querySelector('#bannerContainer .toast'), `${rot}: o toque não dispensou o aviso`);
    }
    await page.click('#helpBtn');
    await esperarOuExplodir(page, () => (topOpenModal() || {}).id === 'helpModal', `${rot}: a Ajuda não abriu`);
    await page.click('#abrirTreino');
    await esperarOuExplodir(page, () => Treino.ativo === true && !topOpenModal(), `${rot}: o "Praticar" não abriu o treino`);
    await doisQuadros(page);
    const noTreino = await page.evaluate(() => ({ faixa: !document.getElementById('treinoBanner').classList.contains('hidden'),
      banners: document.querySelectorAll('#bannerContainer .toast').length }));
    checa(noTreino.faixa && noTreino.banners === 0,
      `${rot}: "Rejeição enviada ao Waze em seu nome" ficou por cima do card de TREINO e da faixa "nada é enviado ao Waze"`, JSON.stringify(noTreino));
    checa((await marcas(page)).reject === dispensado, dispensado
      ? `${rot}: a marca do aviso já visto foi desfeita`
      : `${rot}: o aviso saiu da tela no treino e ficou GASTO — não volta`);
    await page.click('#treinoSairBtn');
    await esperarOuExplodir(page, () => Treino.ativo === false, `${rot}: o "Sair" não saiu do treino`);
    const veio = await esperarNaPagina(page, () => !!document.querySelector('#bannerContainer .toast'), dispensado ? 1500 : 5000, 50);
    if (dispensado) {
      checa(!veio.ok, `${rot}: o aviso que a pessoa dispensou voltou no fim do treino (duas vezes na vida)`);
    } else {
      checa(veio.ok, `${rot}: o aviso que o treino tirou da tela não voltou quando ele acabou`);
      const b = await banner(page);
      checa(!!b && b.recebe === 9, `${rot}: o banner que voltou não recebe o toque inteiro`, JSON.stringify(b));
      checa((await marcas(page)).reject, `${rot}: o banner voltou e não ficou marcado`);
    }
    checa(erros.length === 0, `${rot}: erro de JS`, erros[0]);
    await ctx.close();
  }
  // (6) R14-7-A3: as Preferências abertas na janela do ✓ que completa a cota do
  // Desfazer (L6, o 10º): o interruptor está vivo (CONTROLE); o "Desfazer" do
  // banner, POR CIMA do modal, devolve o placar a 9 — e o interruptor trava na
  // hora, ligado, com "falta 1". Ele seguia vivo, e desligá-lo deixava a chave
  // desligada na tela com o Desfazer ligado por baixo.
  {
    const rot = 'avisos de uma vez (6, a cota do Desfazer com as Preferências abertas)';
    const { ctx, page, erros } = await abrirApp({ viewport: PIXEL, aviso: 'desbloqueio' });
    await page.click(FRENTE + ' .card-btn-read');
    await esperarOuExplodir(page, () => !!AppState.pendingAction, `${rot}: o ✓ não abriu a janela`);
    await page.click('#filtersBtn');
    await esperarOuExplodir(page, () => (topOpenModal() || {}).id === 'filtersModal', `${rot}: os Filtros não abriram`);
    await page.click('#filtersTabPrefs');
    const chave = () => page.evaluate(() => {
      const cb = document.getElementById('prefUndoEnabled');
      const msg = document.getElementById('prefUndoGateMsg');
      return { placar: AppState.stats.read + AppState.stats.rejected, viva: !cb.disabled, ligada: cb.checked,
        frase: !msg.classList.contains('hidden') && msg.textContent.trim().length > 0, janela: !!AppState.pendingAction };
    });
    const antes = await chave();
    checa(antes.janela && antes.placar === 10 && antes.viva && antes.ligada,
      `${rot}: CONTROLE — com o 10º na janela, o interruptor não estava vivo`, JSON.stringify(antes));
    // O "Desfazer" recebe o toque por cima do modal (o banner é z-70).
    const quem = await page.evaluate(() => { const r = document.getElementById('undoBtn').getBoundingClientRect();
      const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return h && (h.id || h.closest('#undoBtn')?.id); });
    checa(quem === 'undoBtn', `${rot}: PRÉ-CONDIÇÃO — o "Desfazer" não recebe o toque por cima dos Filtros`, String(quem));
    await page.click('#undoBtn');
    await esperarOuExplodir(page, () => !AppState.pendingAction, `${rot}: o "Desfazer" não fechou a janela`);
    await doisQuadros(page);
    const depois = await chave();
    checa(depois.placar === 9 && !depois.viva && depois.ligada && depois.frase,
      `${rot}: o placar voltou a 9 (abaixo da cota) e o interruptor seguiu VIVO nas Preferências abertas`, JSON.stringify(depois));
    checa(erros.length === 0, `${rot}: erro de JS`, erros[0]);
    await ctx.close();
  }
}

// ── O CARIMBO DE NASCIMENTO EXISTE DEPOIS DE ABRIR ─────────────────────────
//
// É o guard que teria pego o defeito original, e nenhum outro pegaria: a função
// nasceu sem chamador na v2026.09.18-02 e `diagSessao().nascimento` saiu `null`
// em TODO diagnóstico por dois dias. Os testes de unidade FATIAM a fonte em vez
// de rodá-la, então "declarada mas nunca chamada" passava limpo.
//
// O CONTROLE aqui é o diário, que é o instrumento IRMÃO e depende do mesmo
// armazenamento: se ele também estivesse vazio, "carimbo ausente" não provaria
// nada — seria só um navegador recém-aberto. Foi exatamente assim que a minha
// primeira medição reprovou, e com razão.
{
  for (const cenario of ['normal', 'pelo código de pareamento']) {
    const id = `carimbo/${cenario}`;
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 },
      serviceWorkers: 'block', locale: 'pt-BR' });
    const page = await ctx.newPage();
    const errosJS = [];
    page.on('pageerror', (e) => errosJS.push(String(e.message || e)));
    let bateuNoParear = false;
    await page.route('**/api/**', (r) => {
      if (/parear/.test(r.request().url())) bateuNoParear = true;
      r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(cenario === 'normal' ? { success: true } : { success: false, error: 'x' }) });
    });
    // O ramo do pareamento tem `return` ANTES do resto do initApp: é a carga
    // que deixaria de carimbar se a chamada descesse um punhado de linhas.
    const alvo = cenario === 'normal' ? BASE : BASE + '/#pair=ABC123XYZ';
    await page.goto(alvo, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);

    if (cenario !== 'normal') {
      checa(bateuNoParear, `${id}: CONTROLE falhou — o ramo do pareamento não foi tomado, então nada abaixo mede o que diz medir`);
    }
    const um = await page.evaluate(() => localStorage.getItem('waze_places_nascimento'));
    checa(!!um && Number(um) > 0, `${id}: a carga NÃO escreveu o carimbo — `
      + '`diagSessao().nascimento` volta a sair null em todo diagnóstico');

    // Recarregar não pode reescrever: se reescrevesse, a idade zeraria a cada
    // abertura e o detector nunca acusaria apagamento nenhum.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const dois = await page.evaluate(() => localStorage.getItem('waze_places_nascimento'));
    checa(dois === um, `${id}: recarregar REESCREVEU o carimbo — a idade zera a cada abertura e o detector fica cego`);

    // CONTROLE + contraprova: o diário (instrumento irmão, mesmo armazenamento)
    // grava quando há evento, e o carimbo continua o MESMO.
    // `API` é `const` no api.js, e `const` de topo em script clássico NÃO vira
    // propriedade de `window` — só entra no escopo léxico global. Então
    // `window.API` é SEMPRE undefined e testar por ele nunca dá verdadeiro:
    // a primeira versão deste bloco virava um no-op silencioso e o controle
    // acusava "diário vazio" por culpa da medição. Vizinho do gotcha #64.
    // Os scripts ainda são `defer`, então a espera continua necessária — o que
    // muda é POR QUEM se espera.
    await esperarNaPagina(page, () => typeof API !== 'undefined' && !!API.setSession, 5000);
    const par = await page.evaluate(async () => {
      if (typeof API === 'undefined' || !API.setSession) return { semApi: true };
      API.setSession('t-de-teste', 'cookies');
      await new Promise((ok) => setTimeout(ok, 250));
      const s = typeof diagSessao === 'function' ? diagSessao() : {};
      return { diario: (s.diario || []).length, nascimento: s.nascimento,
               idadeH: s.idadeDoArmazenamentoH };
    });
    checa(!par.semApi, `${id}: CONTROLE falhou — o objeto API não carregou, então a medição abaixo não mede nada`);
    checa(par.diario > 0, `${id}: CONTROLE falhou — o diário também não gravou, então o carimbo não prova nada`);
    checa(par.nascimento !== null && par.idadeH !== null,
      `${id}: o diagSessao ainda devolve nascimento/idade nulos — é o defeito original de volta`);

    checa(errosJS.length === 0, `${id}: erro de JS`, errosJS[0]);
    await ctx.close();
  }
}

// ── FILA DE SAÍDA: offline não perde o que você fez ────────────────────────
//
// Os guards de `test/fila-saida.test.mjs` leem o FONTE. O que só o navegador
// responde é se a coisa acontece: se o placar de fato não reverte, se a fila
// sobrevive a matar o app, e se o esvaziamento sai com RITMO em vez de rajada.
//
// Simular offline aqui tem duas armadilhas que já morderam ao escrever isto:
//   · `route.fulfill` NÃO passa pela rede, então `setOffline` sozinho não
//     derruba requisição interceptada — as ações davam CERTO e dois checks
//     "passavam" pelo motivo errado. Offline de verdade é `route.abort`.
//   · `abort` sem `setOffline` simula SINAL FRACO (`navigator.onLine` fica
//     true e as 2 retentativas ainda rodam, ~5s por ação), não modo avião.
//     Os dois cenários existem na estrada; este bloco mede o modo avião.
// A espera do fim do esvaziamento mora em `tools/esperar-saida.mjs` (fonte
// única): o `smoke-offline.mjs` precisa da MESMA espera, e quando ela era local
// aqui eu repeti lá, palavra por palavra, o erro que o comentário dela descreve.

{
  const CENARIOS = [{ id: 'fila-saida', n: 8 }];
  for (const c of CENARIOS) {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 },
      serviceWorkers: 'block', locale: 'pt-BR' });
    // No CONTEXTO, embaixo da rota da página (que tem precedência e segue
    // abortando no modo avião): só pega o pedido que cai na troca `unroute` →
    // `route` lá embaixo. O `online` do `setOffline(false)` pede a lista de novo
    // quando o último pedido de token tem mais de 5 min — no runner o bloco
    // passa disso, e o pedido ia pro servidor de verdade no meio da troca.
    await presencaViva(ctx);
    const page = await ctx.newPage();
    const errosJS = [];
    // O WebKit às vezes loga como "controle de acesso" o pedido que o modo avião
    // daqui aborta, e o Playwright o entrega como `pageerror` (ver `ruidoDoMotor`).
    page.on('pageerror', (e) => { const m = String(e.message || e); if (!ruidoDoMotor(m)) errosJS.push(m); });
    let semRede = false;
    let enviosDeAcao = [];
    let atrasoDaAcaoMs = 0;   // usado só pra alargar a janela do teste de reenvio
    let abortLento = false;  // alarga a janela do bloco DOIS TEMPOS (ver lá)
    // A conta do aparelho. Cada item da fila de saída leva a conta do GESTO, e o
    // esvaziamento ESPERA enquanto a conta de agora for desconhecida. O bloco
    // injetava o perfil direto no `AppState` e a rota respondia `{"success":true}`
    // SEM perfil na reabertura: a conta nunca ficava conhecida e a ABERTURA
    // reprovava medindo a FIXTURE (gotcha #52 — helper que arruma a tela é
    // fixture). Agora o perfil passa pelo caminho REAL: `definirPerfil` no
    // `montar` e a rota do perfil respondendo como o servidor responde.
    const PERFIL_FS = { id: 1, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false,
      editableCountryIDs: [30], areas: [], managedAreas: [] };
    await page.route('**/*.waze.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }));
    await page.route('**/api/**', async (r) => {
      if (semRede) {
        // ALARGA a janela de propósito, só no bloco DOIS TEMPOS. A corrida é
        // real com ~30ms aqui e o runner do CI a produz sozinho por lentidão —
        // medir por sorte de timing é não medir (foi o que fez este cenário
        // passar 3 vezes aqui enquanto reprovava lá).
        if (abortLento) await new Promise((ok) => setTimeout(ok, 900));
        return r.abort('internetdisconnected');
      }
      if (/validar-place|marcar-lido/.test(r.request().url())) {
        enviosDeAcao.push(Date.now());
        if (atrasoDaAcaoMs) await new Promise((ok) => setTimeout(ok, atrasoDaAcaoMs));
      }
      if (/\/api\/perfil$/.test(new URL(r.request().url()).pathname)) {
        return r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ success: true, profile: PERFIL_FS, visivelNoWme: true }) });
      }
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.setItem('waze_session_token', 't'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await dormir(400);
    const CARDS_FS = Object.entries(CARDS).map(([, p]) => p);
    const montar = () => page.evaluate(({ f, perfil }) => {
      if (typeof API !== 'undefined' && API.setSession) API.setSession('t', 'cookies');
      AppState.authenticated = true;
      // Pela FONTE ÚNICA do perfil, que carimba a conta do aparelho (ver PERFIL_FS).
      definirPerfil({ success: true, profile: perfil });
      // Desfazer DESLIGADO de verdade: a preferência sozinha não basta, o
      // canDisableUndo() também exige a cota (a pegadinha do doc).
      AppState.stats = { read: 500, rejected: 500, skipped: 0 };
      AppState.preferences = Object.assign({}, AppState.preferences,
        { undoEnabled: false, undoGateSeen: true, dicaDesfazerVista: true });
      AppState.serverTotal = f.length; AppState.hasMore = false;
      AppState.countries = [{ id: 30, name: 'Brazil' }]; AppState.statesByCountry = { 30: [] };
      document.getElementById('authScreen').classList.add('hidden');
      document.getElementById('appScreen').classList.remove('hidden');
      renderProfileHeader(AppState.profile); updateStats(); showLoading(false);
      document.getElementById('noMoreCards').classList.add('hidden');
      document.querySelectorAll('.place-card').forEach((e) => e.remove());
      AppState.queue = f.slice(); AppState.currentPlace = null; showCurrentPlace();
    // Seis CÓPIAS dos cards pra ter ações de sobra — e cada card com o pedido
    // PRÓPRIO. Eram cópias idênticas, com os mesmos ids, e a própria `CARDS`
    // tem dois cards com o mesmo pedido (`v6`/`u6`): a fila real nunca tem dois
    // cards do mesmo pedido (gotcha 3.5), e desde v2026.09.22-06 a fila de saída
    // recusa o mesmo pedido duas vezes (é a segunda decisão do relato de reabrir
    // sem rede). A 7ª e a 8ª ação caíam em pedidos já decididos, e o bloco
    // acusava "o placar reverteu" medindo a fixture, não o app.
    }, { perfil: PERFIL_FS, f: Array.from({ length: 6 }, (_, i) => CARDS_FS.map((p, k) => ({ ...p,
      updateRequestID: String(p.updateRequestID) + '-c' + i + '-' + k }))).flat() });
    const estado = () => page.evaluate(() => ({
      rejeitados: AppState.stats.rejected,
      saida: JSON.parse(localStorage.getItem('waze_places_saida') || '[]').length,
      aviso: (document.getElementById('inFlightIndicator') || {}).textContent || '',
    }));
    // Espera o card TROCAR, não a trava: logo depois do clique há ~1s em que
    // `acoesTravadas()` ainda é false e o botão segue habilitado.
    const tratar = (n) => page.evaluate(async (n) => {
      const atual = () => (AppState.currentPlace && AppState.currentPlace.venueID) || null;
      const btn = () => document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-reject');
      for (let i = 0; i < n; i++) {
        const lim = performance.now() + 20000;
        while (((typeof acoesTravadas === 'function' && acoesTravadas()) || !btn() || btn().disabled)
               && performance.now() < lim) await new Promise((o) => setTimeout(o, 16));
        const a = atual(); const b = btn(); if (!b) break; b.click();
        while (atual() === a && performance.now() < lim) await new Promise((o) => setTimeout(o, 16));
      }
    }, n);

    await montar(); await dormir(600);
    const antes = await estado();
    // MODO AVIÃO: a rota cai E `navigator.onLine` fica false (sem o segundo,
    // as retentativas rodam e o teste mede com ações ainda em voo).
    semRede = true; await ctx.setOffline(true);
    await tratar(c.n);
    await esperarNaPagina(page, () => AppState.inFlightActions === 0, 30000);
    const offline = await estado();
    checa(offline.saida === c.n, `${c.id}: ${c.n} ações offline deviam estar na fila (${offline.saida})`);
    checa(offline.rejeitados === antes.rejeitados + c.n,
      `${c.id}: o placar REVERTEU (${antes.rejeitados} → ${offline.rejeitados}) — é o defeito original de volta`);
    checa(/\d/.test(offline.aviso), `${c.id}: o indicador não diz quantas esperam`, JSON.stringify(offline.aviso));

    // Matar e reabrir: a fila de saída tem que sobreviver (a de PEDIDOS não,
    // e isso é esperado — ela é memória, e persistir é outro degrau).
    await ctx.setOffline(false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await dormir(600);
    const sobrou = await page.evaluate(() => JSON.parse(localStorage.getItem('waze_places_saida') || '[]').length);
    checa(sobrou === c.n, `${c.id}: a fila de saída não sobreviveu ao recarregamento (${sobrou})`);

    // Volta a rede: esvazia, UMA requisição por ação, com ritmo.
    //
    // ESPERA PELO FIM, não por um prazo. A versão anterior dava 40s e media —
    // e no CI isso reprovou três vezes com "restam 6 / 2 requisições". O
    // diagnóstico que este bloco imprime fechou a questão: `diario=[]`, ou
    // seja o esvaziamento NÃO TINHA TERMINADO (ele grava `saida.saiu` ao
    // acabar e `saida.erro` se estoura), com `emVoo=0`, `travado=false` e
    // `online=true` — nada bloqueando, só lento. Ele anda 400ms por item via
    // `setTimeout`, e no runner o timer é estrangulado a ponto de 8 itens não
    // caberem na janela. Prazo fixo mede a VELOCIDADE do runner; o que o teste
    // quer saber é o RESULTADO. Nenhuma asserção afrouxa: contagem de
    // requisições, mediana do ritmo e fila zerada seguem as mesmas.
    await page.bringToFront();
    await montar(); await dormir(400);
    enviosDeAcao = []; semRede = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    const porQue = await esperarFimDaSaida(page);
    await dormir(500);
    const fim = await estado();
    // DIAGNÓSTICO sempre impresso, não só na falha: este bloco reprovou no CI
    // duas vezes com "restam 6 / 2 requisições" e NÃO reproduz aqui — nem com
    // CPU 8× mais lenta, nem com a mesma sequência de recarga. Sem saber por
    // que o laço termina, qualquer conserto é chute. O diário do `dfato` diz
    // exatamente isso: `saida.saiu` traz quantas saíram, `saida.erro` denuncia
    // exceção no laço, e a ausência dos dois significa que ele nem terminou.
    const diag = await page.evaluate(() => ({
      diario: (typeof dfatoAnel !== 'undefined' ? dfatoAnel : [])
        .filter((e) => String(e.k).startsWith('saida')).slice(-6),
      auth: AppState.authenticated,
      emVoo: AppState.inFlightActions,
      travado: typeof acoesTravadas === 'function' ? acoesTravadas() : null,
      pend: !!AppState.pendingAction,
      online: navigator.onLine,
    }));
    console.log(`  · ${c.id} [diagnóstico] espera=${JSON.stringify(porQue)} `
      + `restam=${fim.saida} envios=${enviosDeAcao.length} `
      + `auth=${diag.auth} emVoo=${diag.emVoo} travado=${diag.travado} pend=${diag.pend} `
      + `online=${diag.online} diario=${JSON.stringify(diag.diario)}`);
    const gaps = enviosDeAcao.slice(1).map((t, i) => t - enviosDeAcao[i]).sort((a, b) => a - b);
    const mediana = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    checa(fim.saida === 0, `${c.id}: a fila não esvaziou (restam ${fim.saida})`);
    checa(enviosDeAcao.length === c.n,
      `${c.id}: saíram ${enviosDeAcao.length} requisições para ${c.n} ações — duplicou ou perdeu`);
    checa(mediana >= 350,
      `${c.id}: esvaziou em RAJADA (mediana ${mediana}ms) — é o padrão que faz um WAF marcar cliente`);
    checa(!/\d/.test(fim.aviso), `${c.id}: o indicador ficou na tela depois de esvaziar`);

    // A REDE QUE VOLTA EM DOIS TEMPOS — o `online` que chega com o
    // esvaziamento no ar NÃO pode ser descartado.
    //
    // `navigator.onLine === true` não prova rede (o projeto já não confia nele
    // em nenhum outro lugar). Saindo de um túnel ou de um elevador o navegador
    // manda um `online` com a rede ainda ruim e outro logo depois já firme. O
    // primeiro entra no esvaziamento, quebra no `transient` e sai; o segundo
    // chega DENTRO da janela e batia na guarda de reentrada, sumindo. Resultado
    // medido: fila presa em 2 com `esvaziando:false` e `onLine:true`, e o
    // próximo gatilho só na abertura seguinte do app — podem ser horas.
    //
    // Foi ISTO que reprovou o bloco POUSO-RUIM no CI, e não a ordem do
    // `online`: lá o runner produz a mesma janela por lentidão. Aqui ela é
    // EXPLÍCITA (`abortLento`), porque com os ~30ms naturais o cenário passava
    // três vezes seguidas enquanto o CI reprovava.
    await montar(); await dormir(400);
    semRede = true; await ctx.setOffline(true);
    await tratar(2);
    await esperarNaPagina(page, () => AppState.inFlightActions === 0, 30000);
    const dt0 = await estado();
    checa(dt0.saida === 2, `${c.id}: DOIS TEMPOS — as 2 ações não entraram na fila (${dt0.saida})`);
    abortLento = true;
    await ctx.setOffline(false);
    enviosDeAcao = [];
    await page.evaluate(() => window.dispatchEvent(new Event('online')));  // rede AINDA ruim
    await dormir(120);
    // CONTROLE do instrumento: sem um esvaziamento de fato no ar, este cenário
    // mediria o caso fácil e passaria com a guarda quebrada.
    const naJanela = await page.evaluate(() => (typeof esvaziandoSaida !== 'undefined' ? esvaziandoSaida : null));
    checa(naJanela === true,
      `${c.id}: DOIS TEMPOS — o esvaziamento não estava no ar (${naJanela}): o cenário não mediria nada`);
    semRede = false; abortLento = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));  // rede firme, DENTRO da janela
    await esperarFimDaSaida(page, 30000);
    await dormir(300);
    const dt1 = await estado();
    checa(dt1.saida === 0,
      `${c.id}: DOIS TEMPOS — o 2º \`online\` foi ENGOLIDO e a fila ficou presa (${dt1.saida}) com a rede boa`);
    checa(enviosDeAcao.length === 2,
      `${c.id}: DOIS TEMPOS — saíram ${enviosDeAcao.length} requisições para 2 ações`);

    // O RELATO DO OWNER (iPhone, 2026-09-21): modo avião, trata 3, sai do modo
    // avião — e o "3 esperando envio" fica PARADO. Ele trata mais 2, que saem na
    // hora, e os 3 continuam lá.
    //
    // A causa não é o evento faltar: ele CHEGA quando o rádio liga, e nesse
    // instante a rede ainda não passa tráfego — o esvaziamento entra, quebra no
    // `transient` e sai. Depois disso não vem gatilho nenhum, porque os dois que
    // existiam eram o `online` (já gasto) e a ABERTURA (o app não foi fechado).
    //
    // O terceiro gatilho é a PROVA DE REDE: uma resposta nossa que chegou. Aqui
    // o cenário NÃO dispara `online` nenhum depois do primeiro — quem tem que
    // drenar a fila é o sucesso das ações novas.
    await montar(); await dormir(400);
    semRede = true; await ctx.setOffline(true);
    await tratar(3);
    await esperarNaPagina(page, () => AppState.inFlightActions === 0, 30000);
    const pv0 = await estado();
    checa(pv0.saida === 3, `${c.id}: PROVA DE REDE — as 3 ações não entraram na fila (${pv0.saida})`);
    // Sai do modo avião com a rede AINDA ruim: o `online` do navegador é gasto
    // aqui, contra uma rota que ainda aborta.
    abortLento = true;
    await ctx.setOffline(false);
    await dormir(1400);
    const pv1 = await estado();
    // CONTROLE do instrumento: se a fila já tivesse drenado aqui, o resto do
    // cenário mediria o caso fácil e passaria com o gancho arrancado.
    checa(pv1.saida === 3,
      `${c.id}: PROVA DE REDE — a fila drenou no \`online\` (${pv1.saida}): o cenário não mediria o gancho`);
    // A rede FIRMA. Nenhum evento novo — é exatamente o estado do relato.
    semRede = false; abortLento = false;
    await dormir(600);
    enviosDeAcao = [];
    await tratar(2);                      // as 2 novas saem com sucesso
    await esperarFimDaSaida(page, 30000);
    await dormir(400);
    const pv2 = await estado();
    checa(pv2.saida === 0,
      `${c.id}: PROVA DE REDE — ${pv2.saida} ficaram presas com a rede boa: é o relato do owner de volta`);
    checa(enviosDeAcao.length === 5,
      `${c.id}: PROVA DE REDE — saíram ${enviosDeAcao.length} requisições (esperado 5: as 2 novas + as 3 presas)`);
    checa(!/\d/.test(pv2.aviso),
      `${c.id}: PROVA DE REDE — o indicador ficou na tela depois de drenar`);

    // O GATILHO DA ABERTURA, sozinho: sem nenhum evento `online`, só ABRIR o app
    // tem que drenar. É o caminho de quem ficou offline e FECHOU tudo — e ele já
    // nasceu quebrado uma vez, porque quem põe `AppState.authenticated` é o
    // `showMainScreen()` e o esvaziamento estava sendo chamado antes dele (saía
    // na primeira linha, calado, com a chamada no lugar pra enganar).
    //
    // A página velha é MORTA (`about:blank`) antes de a rede voltar, de
    // propósito: com ela viva, o `setOffline(false)` dispara o `online` DELA e
    // a medição passa a somar dois gatilhos — foi o que fez esta asserção
    // acusar "4 requisições para 3 ações" na primeira rodada. Medido item a
    // item: as duas primeiras eram do MESMO pedido, em páginas diferentes.
    await montar(); await dormir(400);
    semRede = true; await ctx.setOffline(true);
    await tratar(3);
    await esperarNaPagina(page, () => AppState.inFlightActions === 0, 30000);
    const presos = await page.evaluate(() => JSON.parse(localStorage.getItem('waze_places_saida') || '[]').length);
    checa(presos === 3, `${c.id}: ABERTURA — as 3 ações não entraram na fila (${presos})`);
    await page.goto('about:blank');          // mata a página VELHA antes da rede voltar
    await ctx.setOffline(false); semRede = false; enviosDeAcao = [];
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });   // nenhum `online` daqui em diante
    await page.bringToFront();
    await esperarFimDaSaida(page);
    const aberturaRestou = await page.evaluate(() => JSON.parse(localStorage.getItem('waze_places_saida') || '[]').length);
    checa(aberturaRestou === 0,
      `${c.id}: ABERTURA — abrir o app NÃO drenou a fila (${aberturaRestou}): quem fechou offline nunca manda`);
    checa(enviosDeAcao.length === 3,
      `${c.id}: ABERTURA — saíram ${enviosDeAcao.length} requisições para 3 ações presas`);

    // ENTREGA AT-LEAST-ONCE: matar o app ENTRE o envio e a gravação reenvia o
    // pedido na próxima abertura. Isso é o lado CERTO do trade — a alternativa
    // (tirar da fila antes de saber que saiu) perde a ação, que é o defeito que
    // esta feature existe pra acabar. O que NÃO pode acontecer é contar duas
    // vezes: a 1ª resposta nunca foi processada, então o Histórico ganha UM.
    await page.evaluate(() => {
      localStorage.setItem('waze_places_saida', JSON.stringify([{ tipo: 'reject',
        venueID: 'reenvio', updateRequestID: 77, creatorId: null, nome: null,
        dup: false, t: Date.now(), dia: '2026-01-01', onde: '30' }]));
      const h = JSON.parse(localStorage.getItem('waze_places_history') || '{}');
      h._total = { read: 0, rejected: 0 }; h['2026-01-01'] = { read: 0, rejected: 0 };
      localStorage.setItem('waze_places_history', JSON.stringify(h));
    });
    enviosDeAcao = []; atrasoDaAcaoMs = 700;   // alarga a janela entre mandar e gravar
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    // Espera pelo lado do NODE (o array das rotas), nunca por um valor que o
    // route handler escreveria na página: `page.evaluate` de dentro de um
    // handler PENDENTE não roda, e com `.catch(() => {})` isso vira espera
    // silenciosa. Já me custou um cenário inteiro que media nada.
    const ate = Date.now() + 20000;
    while (!enviosDeAcao.length && Date.now() < ate) await dormir(50);
    checa(enviosDeAcao.length > 0, `${c.id}: REENVIO — nenhum envio saiu; o cenário não mediria nada`);
    await dormir(150);
    await page.goto('about:blank');            // mata no meio do voo
    atrasoDaAcaoMs = 0;
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await esperarFimDaSaida(page);
    await dormir(300);
    const reenvio = await page.evaluate(() => ({
      saida: JSON.parse(localStorage.getItem('waze_places_saida') || '[]').length,
      hist: ((JSON.parse(localStorage.getItem('waze_places_history') || '{}')._total) || {}).rejected,
    }));
    checa(reenvio.saida === 0,
      `${c.id}: REENVIO — a ação interrompida no voo ficou presa (${reenvio.saida}): seria perda`);
    checa(enviosDeAcao.length === 2,
      `${c.id}: REENVIO — esperava 2 envios (o interrompido + o reenvio), vieram ${enviosDeAcao.length}`);
    checa(reenvio.hist === 1,
      `${c.id}: REENVIO — o Histórico contou ${reenvio.hist}× o mesmo pedido: a 1ª resposta nunca chegou, então é UM`);

    // O POUSO que falha DE VERDADE: a ação esperou offline, a rede voltou, e o
    // Waze recusa por um motivo que não é rede. O placar é PERSISTIDO, então o
    // número que subiu no gesto tem que descer AGORA — senão "Rejeitados" fica
    // inflado pra sempre por algo que nunca saiu. É a única trilha que mexe num
    // número gravado sem passar pelo `handleActionResult`.
    await montar(); await dormir(400);
    const a3 = await estado();
    semRede = true; await ctx.setOffline(true);
    await tratar(2);
    await esperarNaPagina(page, () => AppState.inFlightActions === 0, 30000);
    const espera3 = await estado();
    checa(espera3.saida === 2, `${c.id}: POUSO-RUIM — as 2 ações não entraram na fila (${espera3.saida})`);
    checa(espera3.rejeitados === a3.rejeitados + 2,
      `${c.id}: POUSO-RUIM — o placar já reverteu antes do pouso`);
    await ctx.setOffline(false);
    await page.unroute('**/api/**');
    await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
      body: '{"success":false,"error":"x","errorCategory":"unknown","httpCode":500}' }));
    semRede = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await esperarFimDaSaida(page);
    await dormir(400);
    const pouso3 = await page.evaluate(() => ({
      rejeitados: AppState.stats.rejected,
      saida: JSON.parse(localStorage.getItem('waze_places_saida') || '[]').length,
      // GRAVADO, não só em memória: sem isto o número volta inflado no reload.
      gravado: (JSON.parse(localStorage.getItem('waze_places_stats') || '{}') || {}).rejected,
    }));
    checa(pouso3.saida === 0, `${c.id}: POUSO-RUIM — a fila não drenou (${pouso3.saida})`);
    checa(pouso3.rejeitados === a3.rejeitados,
      `${c.id}: POUSO-RUIM — o placar ficou inflado (${a3.rejeitados} → ${pouso3.rejeitados}) por ação que NUNCA saiu`);
    checa(pouso3.gravado === a3.rejeitados,
      `${c.id}: POUSO-RUIM — desfez na tela mas não GRAVOU (${pouso3.gravado}): volta inflado no reload`);

    // CONTROLE: erro que NÃO é rede continua revertendo, como sempre.
    await page.unroute('**/api/**');
    await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
      body: '{"success":false,"error":"x","errorCategory":"unknown","httpCode":500}' }));
    await montar(); await dormir(400);
    const a2 = await estado();
    await tratar(1);
    await esperarNaPagina(page, () => AppState.inFlightActions === 0, 20000);
    const d2 = await estado();
    checa(d2.saida === 0, `${c.id}: CONTROLE — erro desconhecido entrou na fila (${d2.saida})`);
    checa(d2.rejeitados === a2.rejeitados,
      `${c.id}: CONTROLE — erro desconhecido deixou de reverter o placar`);

    checa(errosJS.length === 0, `${c.id}: erro de JS`, errosJS[0]);
    await ctx.close();
  }
}

// ── PRESENÇA NO WME: a posição vai DE CARONA na ação (fase 2) ─────────────
//
// Medido pela REDE, com o app de verdade (o JS minificado que vai pro ar): o
// que cada ação leva, o que a segunda ação logo em seguida NÃO leva (freio de
// 30 s), a visibilidade ligando sozinha de carona, o interruptor desligando o
// WME na hora e religando na ação seguinte, e o invisível do WME NÃO desligando
// o app — a ação seguinte religa de carona (decisão do owner, 2026-09-24). Os
// testes de unidade fatiam a fonte; este roda a tela.
{
  const id = 'presença no WME/Pixel 7';
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block', locale: 'pt-BR' });
  const page = await ctx.newPage();
  const errosJS = [];
  page.on('pageerror', (e) => errosJS.push(String(e.message || e)));
  let visivelNoWme = false;
  const pedidos = [];
  await page.route('**/api/**', async (route) => {
    const rota = route.request().url().split('/api/')[1].split('?')[0];
    let corpo = {};
    try { corpo = JSON.parse(route.request().postData() || '{}'); } catch { /* corpo vazio */ }
    pedidos.push({ rota, corpo });
    const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (rota === 'perfil') {
      return json({ success: true, visivelNoWme,
        // `editableCountryIDs` como o servidor de verdade manda (as contas do owner
        // editam no Brasil): sem ele o app pergunta o perfil nos OUTROS servidores
        // (ver `paisDoPerfil`), e este CONTROLE conta os pedidos de perfil.
        profile: { id: 12444348, userName: 'antigerme', rank: 5, isAreaManager: true, isStaff: false,
          editableCountryIDs: [30], areas: [], managedAreas: [] } });
    }
    if (rota === 'lista-paises') return json({ success: true, countries: [] });
    if (rota === 'validar-place' || rota === 'marcar-lido') {
      return json({ success: true, ...(corpo.presenca ? { presenca: { ok: true, marca: true } } : {}) });
    }
    if (rota === 'presenca-waze') return json({ success: true });
    return json({ success: false });
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const FILA = FIXTURES_PAISES.filter((p) => p.mapa && Array.isArray(p.mapa.centro)).slice(0, 8);
  await page.evaluate(async ({ fila }) => {
    API.setSession('token-de-teste');
    AppState.authenticated = true;
    AppState.preferences.undoEnabled = true;
    AppState.serverTotal = fila.length; AppState.hasMore = false;
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    await loadProfileAndAuxData();       // o caminho REAL do perfil decide a visibilidade
    updateStats(); showLoading(false);
    document.getElementById('noMoreCards').classList.add('hidden');
    document.querySelectorAll('.place-card').forEach((e) => e.remove());
    AppState.queue = JSON.parse(JSON.stringify(fila)); AppState.currentPlace = null; showCurrentPlace();
  }, { fila: FILA });
  await assentar(page);

  const acoesDe = (rota) => pedidos.filter((x) => x.rota === rota);
  const esperarPedido = async (rota, n) => {
    for (let i = 0; i < 80 && acoesDe(rota).length < n; i++) await dormir(100);
    return acoesDe(rota)[n - 1];
  };
  const clicar = (sel) => page.evaluate((s) => document.querySelector('#cardStack .place-card:not(.card-fundo) ' + s).click(), sel);
  const naTela = () => page.evaluate(() => AppState.currentPlace && AppState.currentPlace.mapa.centro);

  // 1. Perfil disse "invisível" e o app nunca a viu ligada: a PRIMEIRA ação liga.
  checa(acoesDe('perfil').length === 1, `${id}: CONTROLE — o perfil não foi pedido pelo caminho real`);
  await clicar('.card-btn-reject');
  const r1 = await esperarPedido('validar-place', 1);
  checa(!!r1, `${id}: o ✕ não chegou à rede (a seção ficaria cega)`);
  const centro1 = await naTela();
  const p1 = r1 && r1.corpo.presenca;
  checa(!!p1, `${id}: a 1ª ação saiu SEM a posição`, JSON.stringify(r1 && r1.corpo));
  checa(p1 && p1.userId === '12444348' && p1.pais === 30, `${id}: posição sem o id da pessoa ou sem o país da fila`, JSON.stringify(p1));
  checa(p1 && p1.lat === centro1[0] && p1.lon === centro1[1],
    `${id}: a posição não é a do card NA TELA, em [lat, lon]`, JSON.stringify({ p1, centro1 }));
  checa(p1 && p1.visivel === true, `${id}: o perfil disse invisível e a 1ª ação não ligou a visibilidade`, JSON.stringify(p1));
  const ligou = await esperarNaPagina(page, () => presencaWme.ligarNaProxima === false, 5000);
  checa(ligou.ok, `${id}: a visibilidade ligou de carona e o app seguiu pedindo pra ligar`);

  // 2. A segunda ação dentro de 30 s vai SEM posição (o freio).
  await page.waitForTimeout(3600);                      // a janela do Desfazer da 1ª
  await clicar('.card-btn-read');
  const r2 = await esperarPedido('marcar-lido', 1);
  checa(!!r2, `${id}: o ✓ não chegou à rede`);
  checa(r2 && !('presenca' in r2.corpo), `${id}: a 2ª ação em menos de 30 s levou posição (o freio sumiu)`, JSON.stringify(r2 && r2.corpo));

  // 3. Desligar o "Ver quem está no app": some do WME NA HORA.
  await page.evaluate(() => { const c = document.getElementById('prefPresenca'); c.checked = false; c.dispatchEvent(new Event('change')); });
  const off = await esperarPedido('presenca-waze', 1);
  checa(!!off && off.corpo.visivel === false && off.corpo.userId === '12444348' && !('posicao' in off.corpo),
    `${id}: desligar não mandou o WME esconder a pessoa (visivel:false)`, JSON.stringify(off && off.corpo));
  await page.waitForTimeout(3600);
  await clicar('.card-btn-reject');
  const r3 = await esperarPedido('validar-place', 2);
  checa(r3 && !('presenca' in r3.corpo), `${id}: com a presença DESLIGADA a ação levou posição`, JSON.stringify(r3 && r3.corpo));

  // 4. Religar: a próxima ação liga de novo, sem esperar o freio.
  await page.evaluate(() => { const c = document.getElementById('prefPresenca'); c.checked = true; c.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(3600);
  await clicar('.card-btn-read');
  const r4 = await esperarPedido('marcar-lido', 2);
  const centro4 = await naTela();
  checa(r4 && r4.corpo.presenca && r4.corpo.presenca.visivel === true,
    `${id}: religar não fez a ação seguinte ligar a visibilidade`, JSON.stringify(r4 && r4.corpo));
  checa(r4 && r4.corpo.presenca && r4.corpo.presenca.lat === centro4[0], `${id}: a posição religada não é a do card na tela`);

  // 5. Invisível pelo WME DEPOIS de o app já tê-la ligado: o WME NÃO desliga o
  //    app (decisão do owner, 2026-09-24). O interruptor segue ligado, nada é
  //    carimbado, e a ação seguinte religa de carona.
  const antes = await page.evaluate(() => AppState.preferences.presencaOffEm);
  visivelNoWme = false;
  await page.evaluate(async () => { await loadProfileAndAuxData(); });
  const estado = await page.evaluate(() => ({ presenca: AppState.preferences.presenca, off: AppState.preferences.presencaOffEm,
                                              chk: document.getElementById('prefPresenca').checked, ligar: presencaWme.ligarNaProxima }));
  checa(estado.presenca !== false && estado.chk === true && estado.off === antes,
    `${id}: o invisível do WME desligou o "Ver quem está no app"`, JSON.stringify(estado));
  checa(estado.ligar === true, `${id}: o invisível do WME não fez o app pedir pra religar`, JSON.stringify(estado));
  await page.waitForTimeout(3600);
  await page.evaluate(() => { presencaWme.ultimaEm = 0; });   // sem esperar o freio de 30 s da ação 4
  await clicar('.card-btn-reject');
  const r5 = await esperarPedido('validar-place', 3);
  checa(r5 && r5.corpo.presenca && r5.corpo.presenca.visivel === true,
    `${id}: depois do invisível do WME a ação não religou a visibilidade`, JSON.stringify(r5 && r5.corpo));
  checa(acoesDe('presenca-waze').length === 1,
    `${id}: o app chamou a rota da presença por conta própria (só o gesto de desligar chama)`, JSON.stringify(acoesDe('presenca-waze')));

  checa(errosJS.length === 0, `${id}: erro de JS no caminho da presença`, errosJS[0]);
  await ctx.close();
}

// ── GESTOS E TECLAS QUE NÃO DECIDEM (auditoria de 2026-09-26) ───────────────
//
// Um gesto, uma tecla ou uma resposta que chega DURANTE o gesto decidia um
// pedido que ninguém decidiu — ou deixava de desfazer o que a pessoa pediu pra
// desfazer. Os testes de unidade (gestos-card, lightbox-tab, lightbox-escritas)
// rodam as peças; aqui é o NAVEGADOR: toque por CDP, mouse e teclado de
// verdade, rede de mentira por rota e o log do que SAIU pelo fio.
//
//  C1 · a pinça na foto do card decidia (abrindo → lido; fechando → rejeitado).
//  C6 · puxar pra BAIXO com desvio de lado rejeitava ou marcava lido.
//  C2 · arrastar com o MOUSE pela foto ou pelo mapa começava o arrastar nativo
//       de imagem: o card seguia o cursor sem botão, e o clique seguinte em
//       qualquer lugar (Filtros) cometia a ação.
//  C3 · a aprovação de uma foto pousando durante a saída do card fazia o ✓, a
//       seta e o arraste agirem no pedido SEGUINTE.
//  C7 · com o foco na lista de mudanças, o ↑ pulava e ← → decidiam.
//  C8 · a exclusão de foto não se desfazia pelo teclado, e o Tab não chegava ao
//       Desfazer, que aparece por cima do lightbox.
//
// Toda "não decidiu" tem o CONTROLE ao lado: o mesmo caminho, com o gesto que
// decide, decidindo — senão um app com o gesto morto passaria verde.
const GESTOS_L6 = { id: 1, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false };
const gestosFoto = (id) => `https://venue-image.waze.com/thumbs/thumb700_${id}.jpg`;
const gestosPedidoDeFoto = (id, outras = []) => ({
  venueID: 'v-' + id, updateRequestID: id, name: 'Padaria ' + id, localAprovado: true,
  categories: ['BAKERY'], address: 'Rua XV de Novembro, 100 - Centro',
  updateType: 'Nova Foto', updateTypeKey: 'IMAGE', reqType: 'IMAGE', reqSubType: '', purType: 'NEW_PHOTO',
  createdBy: 'joaozinho', brand: null, changes: [],
  imageUrls: [...outras.map(gestosFoto), gestosFoto(id)], approvedImageIds: outras.slice(),
  dateAdded: 1785203731191, lat: -20.8, lon: -49.4,
});
// Pedido REAL (fixture de país) com id próprio — as fixtures vêm todas com 'fx'.
const gestosDaFixture = (i, id, extra = {}) => ({ ...JSON.parse(JSON.stringify(FIXTURES_PAISES[i])),
  venueID: 'v-' + id, updateRequestID: id, ...extra });

// Uma página com a fila montada, a rede de mentira e o log do que SAIU. A
// aprovação de foto fica PRESA até o teste soltar: é o que torna a corrida do
// C3 determinística (ela pousa no meio da saída do card, não "mais ou menos").
async function gestosPagina(opcoes, fila, { lang = 'pt' } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', locale: 'pt-BR', ...opcoes });
  const saiu = [];
  let soltar = () => {};
  const aprovacaoPresa = new Promise((r) => { soltar = r; });
  await ctx.route('**/*-tiles/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_CINZA }));
  await ctx.route(/venue-image\.waze\.com/, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_CINZA }));
  await ctx.route('**/api/**', async (r) => {
    const nome = r.request().url().split('/api/')[1].split('?')[0];
    let corpo = {};
    try { corpo = JSON.parse(r.request().postData() || '{}'); } catch (e) { /* sem corpo */ }
    saiu.push({ nome, aprovar: corpo.approve === true, acao: corpo.action || null, pedido: corpo.updateRequestID || null });
    if (nome === 'validar-place' && corpo.approve === true) await aprovacaoPresa;
    // Cada rota com a FORMA que o app lê: `{ success: true }` cru em
    // `lista-paises` faz o modal de Filtros iterar `undefined`.
    const resp = { 'presenca-app': { success: true, online: [], conversas: [] },
      'lista-paises': { success: true, countries: [] }, 'lista-estados': { success: true, states: [] } }[nome]
      || { success: true };
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resp) }).catch(() => {});
  });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.evaluate(({ fila, perfil, lang: l }) => {
    setLang(l);
    API.setSession('token-do-smoke-de-gestos');
    AppState.authenticated = true;
    AppState.profile = perfil;
    AppState.stats = { read: 0, rejected: 0, skipped: 0 };
    AppState.serverTotal = fila.length; AppState.hasMore = false;
    AppState.preferences.undoEnabled = true;
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    document.getElementById('filtersBtn').classList.remove('hidden');
    renderProfileHeader(AppState.profile); updateStats(); showLoading(false);
    document.getElementById('noMoreCards').classList.add('hidden');
    document.querySelectorAll('.place-card').forEach((e) => e.remove());
    AppState.queue = fila.slice(); AppState.currentPlace = null; showCurrentPlace();
  }, { fila, perfil: GESTOS_L6, lang });
  await assentar(page, 250);
  const fechar = async () => { soltar(); await ctx.close(); };
  return { ctx, page, saiu, soltar, erros, fechar };
}
// O que o app DECIDIU até agora: placar, a ação na janela do Desfazer e quem
// está na frente.
const gestosDecisao = (page) => page.evaluate(() => ({
  lidos: AppState.stats.read, rejeitados: AppState.stats.rejected, pulados: AppState.stats.skipped,
  janela: AppState.pendingAction ? AppState.pendingAction.type + ':' + AppState.pendingAction.place.updateRequestID : null,
  frente: AppState.currentPlace && AppState.currentPlace.updateRequestID,
}));
const gestosNada = (d) => !d.lidos && !d.rejeitados && !d.pulados && !d.janela;

{
  // ── C1 + C6: toque de verdade (CDP) na foto do card ──────────────────────
  if (!pularForaDoChromium(MOTOR, 'gestos/toque: a pinça e o puxão pra baixo na foto do card',
    'toque com DOIS dedos e arraste só se sintetizam pelo protocolo do Chromium (CDP)')) {
    const passos = async (cdp, n, pontosDe, ms) => {
      for (let i = 1; i <= n; i++) {
        await dormir(ms);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pontosDe(i) });
      }
    };
    const TOQUES = [
      ['pinça abrindo, dedos em tempos diferentes', null, async (cdp, b) => {
        const y = b.y + b.h / 2, x1 = b.x + b.w * 0.4, x2 = b.x + b.w * 0.6;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y, id: 0 }] });
        await dormir(30);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y, id: 0 }, { x: x2, y, id: 1 }] });
        await passos(cdp, 10, (i) => [{ x: x1 - i * 12, y, id: 0 }, { x: x2 + i * 12, y, id: 1 }], 16);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }],
      ['pinça fechando', null, async (cdp, b) => {
        const y = b.y + b.h / 2, x1 = b.x + b.w * 0.15, x2 = b.x + b.w * 0.85;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y, id: 0 }] });
        await dormir(30);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y, id: 0 }, { x: x2, y, id: 1 }] });
        await passos(cdp, 10, (i) => [{ x: x1 + i * 11, y, id: 0 }, { x: x2 - i * 11, y, id: 1 }], 16);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }],
      ['pinça com os dois dedos no mesmo evento', null, async (cdp, b) => {
        const y = b.y + b.h / 2, x1 = b.x + b.w * 0.4, x2 = b.x + b.w * 0.6;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y, id: 0 }, { x: x2, y, id: 1 }] });
        await passos(cdp, 10, (i) => [{ x: x1 - i * 12, y, id: 0 }, { x: x2 + i * 12, y, id: 1 }], 16);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }],
      ...[-105, 105].map((dx) => [`puxar pra BAIXO em diagonal (${dx}, +300)`, null, async (cdp, b) => {
        const x = b.x + b.w / 2, y = b.y + 30;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }] });
        await passos(cdp, 20, (i) => [{ x: x + dx * i / 20, y: y + 300 * i / 20, id: 0 }], 30);
        await dormir(150);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }]),
      // CONTROLES: os mesmos dedos, no gesto que DECIDE.
      ['CONTROLE: um dedo, devagar, 60% pra esquerda', 'reject', async (cdp, b) => {
        const x = b.x + b.w * 0.8, y = b.y + b.h / 2;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }] });
        await passos(cdp, 20, (i) => [{ x: x - b.w * 0.6 * i / 20, y, id: 0 }], 30);
        await dormir(150);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }],
      ['CONTROLE: um dedo pra CIMA em diagonal (-105, -300)', 'skip', async (cdp, b) => {
        const x = b.x + b.w / 2, y = b.y + b.h - 10;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }] });
        await passos(cdp, 20, (i) => [{ x: x - 105 * i / 20, y: y - 300 * i / 20, id: 0 }], 30);
        await dormir(150);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }],
    ];
    for (const [nome, espera, gesto] of TOQUES) {
      const id = `gestos/toque: ${nome}`;
      const g = await gestosPagina({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true },
        ['tA', 'tB', 'tC'].map((x) => gestosPedidoDeFoto(x)));
      const b = await g.page.evaluate(() => {
        const r = cardDaFrente().querySelector('.card-photo').getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      const cdp = await g.ctx.newCDPSession(g.page);
      await gesto(cdp, b);
      await g.page.waitForTimeout(800);
      const d = await gestosDecisao(g.page);
      if (espera) {
        checa(d.janela === `${espera}:tA`, `${id}: o gesto que decide deixou de decidir — o teste mediria um app com o gesto morto`, JSON.stringify(d));
      } else {
        checa(gestosNada(d) && d.frente === 'tA', `${id}: o gesto DECIDIU o pedido`, JSON.stringify(d));
        const tr = await g.page.evaluate(() => cardDaFrente().style.transform);
        checa(/^(|translate\(0(px)?, 0(px)?\) rotate\(0deg\))$/.test(tr), `${id}: o card não voltou pro lugar`, tr);
      }
      checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
      await g.fechar();
    }
  }

  // ── C2: arrastar com o MOUSE pela foto e pelo mapa ────────────────────────
  const DESKTOP = { viewport: { width: 1280, height: 800 } };
  const arrastarMouse = async (page, sel, dx, { passos = 10, ms = 30 } = {}) => {
    const b = await page.locator(sel).first().boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= passos; i++) { await page.mouse.move(x + dx * i / passos, y); await page.waitForTimeout(ms); }
    await page.mouse.up();
  };
  const camadas = (page) => page.evaluate(() => ({ foto: Lightbox.isOpen(), mapa: MapaLightbox.isOpen(),
    filtros: !document.getElementById('filtersModal').classList.contains('hidden') }));
  const FOTOS = ['mA', 'mB', 'mC'].map((x) => gestosPedidoDeFoto(x));
  const MAPA = [gestosDaFixture(19, 'mapa1'), gestosDaFixture(25, 'mapa2')].map((p) => ({ ...p, imageUrls: [] }));
  {
    const id = 'gestos/mouse: arrastar pela FOTO e soltar longe';
    const g = await gestosPagina(DESKTOP, FOTOS);
    await arrastarMouse(g.page, '#cardStack .place-card:not(.card-fundo) .card-image', -400);
    await g.page.waitForTimeout(700);
    const d = await gestosDecisao(g.page);
    const c = await camadas(g.page);
    checa(d.janela === 'reject:mA', `${id}: o arraste pela foto não decidiu — o card ficou preso ao cursor`, JSON.stringify(d));
    checa(!c.foto, `${id}: soltar o arraste ABRIU a foto por cima do card que acabava de sair`);
    // O relato: o clique SEGUINTE em Filtros cometia a ação da posição do card preso.
    await g.page.locator('#filtersBtn').click();
    await g.page.waitForTimeout(700);
    const d2 = await gestosDecisao(g.page);
    checa(d2.pulados === 0 && d2.rejeitados === 1, `${id}: o clique em Filtros decidiu mais um pedido`, JSON.stringify(d2));
    checa((await camadas(g.page)).filtros, `${id}: CONTROLE — o clique em Filtros não abriu Filtros`);
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }
  {
    const id = 'gestos/mouse: arrastar pelo MAPA e soltar longe';
    const g = await gestosPagina(DESKTOP, MAPA);
    const temTile = await g.page.evaluate(() => cardDaFrente().querySelectorAll('.card-map:not(.hidden) .mapa-tile').length);
    checa(temTile > 0, `${id}: PRÉ-CONDIÇÃO — o mapa não está na frente com tiles, e o arraste mediria outra coisa`, String(temTile));
    await arrastarMouse(g.page, '#cardStack .place-card:not(.card-fundo) .card-map', 400);
    await g.page.waitForTimeout(700);
    const d = await gestosDecisao(g.page);
    checa(d.janela === 'read:mapa1', `${id}: o arraste pelo mapa não decidiu — o card ficou preso ao cursor`, JSON.stringify(d));
    checa(!(await camadas(g.page)).mapa, `${id}: soltar o arraste ABRIU o mapa ampliado por cima do card que acabava de sair`);
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }
  {
    const id = 'gestos/mouse: arraste CURTO e devagar pela foto';
    const g = await gestosPagina(DESKTOP, FOTOS);
    await arrastarMouse(g.page, '#cardStack .place-card:not(.card-fundo) .card-image', -60, { passos: 12, ms: 40 });
    await g.page.waitForTimeout(700);
    const d = await gestosDecisao(g.page);
    checa(gestosNada(d), `${id}: o arraste curto decidiu`, JSON.stringify(d));
    checa(!(await camadas(g.page)).foto, `${id}: o arraste (que ANDOU) abriu a foto como se fosse clique`);
    // CONTROLE: o clique PARADO na foto abre o lightbox — a armadilha é só do arraste.
    await g.page.locator('#cardStack .place-card:not(.card-fundo) .card-image').click();
    await g.page.waitForTimeout(400);
    checa((await camadas(g.page)).foto, `${id}: CONTROLE — o clique parado na foto deixou de abrir o lightbox`);
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }

  // ── C3: a aprovação pousando durante a saída do card ─────────────────────
  const CORRIDA = [gestosPedidoDeFoto('uB', ['foto-a']), gestosPedidoDeFoto('uC'), gestosPedidoDeFoto('uD')];
  const aprovarEFechar = async (page) => {
    await page.locator('#cardStack .place-card:not(.card-fundo) .card-image').click();
    await page.waitForTimeout(300);
    const pode = await page.evaluate(() => Lightbox.podeAprovarAtual());
    await page.locator('#lightboxApprove').click();
    await page.waitForTimeout(150);
    await page.locator('#lightboxClose').click();   // fechar despacha a aprovação — que fica PRESA
    await page.waitForTimeout(100);
    return pode;
  };
  const CORRIDAS = [
    // `force`: com a aprovação de B no ar, o ✓ de B está TRAVADO (A1), e o
    // clique normal esperaria 30 s ele destravar. O toque de verdade num botão
    // travado não faz nada — que é o que se mede; no app de antes, ele decide B.
    ['o ✓ em B', async (g) => { await g.page.locator('#cardStack .place-card:not(.card-fundo) .card-btn-read').click({ force: true }); g.soltar(); }],
    ['a seta → em B', async (g) => { await g.page.keyboard.press('ArrowRight'); g.soltar(); }],
    ['o arraste de mouse segurando B', async (g) => {
      const b = await g.page.locator('#cardStack .place-card:not(.card-fundo) .card-category-row').boundingBox();
      const x = b.x + b.width / 2, y = b.y + b.height / 2;
      await g.page.mouse.move(x, y); await g.page.mouse.down();
      for (let i = 1; i <= 8; i++) { await g.page.mouse.move(x - 50 * i, y); await g.page.waitForTimeout(30); }
      g.soltar();
      await esperarNaPagina(g.page, () => AppState.currentPlace && AppState.currentPlace.updateRequestID === 'uC', 5000, 50);
      await g.page.mouse.up();
    }],
    ['CONTROLE: sem gesto nenhum', async (g) => { g.soltar(); }],
  ];
  for (const [nome, gesto] of CORRIDAS) {
    const id = `gestos/corrida: ${nome} com a aprovação pousando no meio`;
    const g = await gestosPagina(DESKTOP, CORRIDA);
    const pode = await aprovarEFechar(g.page);
    checa(pode, `${id}: PRÉ-CONDIÇÃO — a foto do pedido não podia ser aprovada`);
    // A1: com a aprovação de B no AR, o card de B está travado — o ✓ mandaria
    // uma segunda decisão do pedido que está sendo aprovado — e o aviso diz qual
    // espera. (Depois de soltar, o card avança pro C e volta a decidir: é o
    // `d.frente === 'uC'` e o `gestosNada` lá embaixo.)
    const trava = await g.page.evaluate(() => ({ lido: cardDaFrente().querySelector('.card-btn-read').disabled,
      rejeitar: cardDaFrente().querySelector('.card-btn-reject').disabled, aviso: avisoDaTrava() }));
    checa(trava.lido && trava.rejeitar && trava.aviso === 'toast.esperaAprovacao',
      `${id}: com a aprovação de B no ar, o card de B seguia decidível (ou o aviso manda esperar outra coisa)`, JSON.stringify(trava));
    await gesto(g);
    await g.page.waitForTimeout(900);
    const d = await gestosDecisao(g.page);
    const escritas = g.saiu.filter((s) => s.nome === 'validar-place' || s.nome === 'marcar-lido')
      .map((s) => s.nome + (s.aprovar ? '(aprovar)' : '') + ':' + s.pedido);
    checa(escritas.join() === 'validar-place(aprovar):uB', `${id}: saiu escrita além da aprovação de B`, escritas.join(', '));
    checa(gestosNada(d) && d.frente === 'uC',
      `${id}: o gesto em B agiu no pedido que entrou na frente (ou a aprovação não avançou o card)`, JSON.stringify(d));
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }

  // ── C7: as setas numa área do card que ROLA ─────────────────────────────
  {
    const id = 'gestos/teclado: setas na lista de mudanças';
    // O diff mais longo das fixtures, em francês, numa tela baixa: a lista ROLA.
    const g = await gestosPagina({ viewport: { width: 393, height: 700 } },
      [gestosDaFixture(25, 'kL', { imageUrls: [foto] }), gestosPedidoDeFoto('kM')], { lang: 'fr' });
    const rola = await g.page.evaluate(() => {
      const l = cardDaFrente().querySelector('.card-changes-list');
      l.focus();
      return { rola: l.scrollHeight > l.clientHeight + 2, foco: document.activeElement === l };
    });
    checa(rola.rola && rola.foco, `${id}: PRÉ-CONDIÇÃO — a lista não rola ou não recebeu o foco`, JSON.stringify(rola));
    // A rolagem pelo teclado é ANIMADA no WebKit: ler num prazo fixo mede o
    // meio do caminho (deu 0 depois do ↓↓ e 48 depois do ↑). Espera ela PARAR.
    const topo = () => g.page.evaluate(() => cardDaFrente().querySelector('.card-changes-list').scrollTop);
    const parado = async () => {
      let a = await topo();
      for (let i = 0; i < 30; i++) {
        await g.page.waitForTimeout(100);
        const b = await topo();
        if (b === a) return b;
        a = b;
      }
      return a;
    };
    await g.page.keyboard.press('ArrowDown'); await g.page.keyboard.press('ArrowDown');
    const desceu = await parado();
    await g.page.keyboard.press('ArrowUp');
    const subiu = await parado();
    checa(desceu > 0 && subiu < desceu, `${id}: ↑ ↓ não rolaram a lista`, `desceu=${desceu} subiu=${subiu}`);
    await g.page.keyboard.press('ArrowLeft'); await g.page.keyboard.press('ArrowRight');
    await g.page.waitForTimeout(700);
    const d = await gestosDecisao(g.page);
    checa(gestosNada(d) && d.frente === 'kL', `${id}: seta com o foco na lista DECIDIU o pedido`, JSON.stringify(d));
    // CONTROLE: com o foco fora da lista, a seta decide.
    await g.page.evaluate(() => document.activeElement.blur());
    await g.page.keyboard.press('ArrowRight');
    await g.page.waitForTimeout(700);
    const d2 = await gestosDecisao(g.page);
    checa(d2.janela === 'read:kL', `${id}: CONTROLE — fora da lista a seta deixou de decidir`, JSON.stringify(d2));
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }

  // ── C8: desfazer a exclusão de foto pelo TECLADO ─────────────────────────
  const FOTO_EXCLUIR = [gestosPedidoDeFoto('uX', ['foto-a', 'foto-b']), gestosPedidoDeFoto('uY')];
  const abrirNaFotoA = async (page) => {
    await page.locator('#cardStack .place-card:not(.card-fundo) .card-image').click();
    await page.waitForTimeout(300);
    await page.evaluate(() => { Lightbox.idx = 0; Lightbox._render(); });
    await page.waitForTimeout(150);
  };
  const fotosNoPedido = (page) => page.evaluate(() => AppState.currentPlace.imageUrls.length);
  const exclusoesDeVerdade = (g) => g.saiu.filter((s) => s.nome === 'excluir-foto' && s.acao !== 'preparar').length;
  const DESFAZERES = [
    ['z no lightbox', async (g) => { await g.page.keyboard.press('z'); }],
    ['Esc e depois z no card', async (g) => { await g.page.keyboard.press('Escape'); await g.page.keyboard.press('z'); }],
    ['Tab até o Desfazer e Enter', async (g) => {
      let achou = false;
      for (let i = 0; i < 15 && !achou; i++) {
        await g.page.keyboard.press('Tab');
        achou = await g.page.evaluate(() => (document.activeElement || {}).id === 'undoBtn');
      }
      checa(achou, 'gestos/teclado: o Tab não chegou ao Desfazer, que está por cima do lightbox');
      if (achou) await g.page.keyboard.press('Enter');
    }],
  ];
  for (const [nome, desfazer] of DESFAZERES) {
    const id = `gestos/teclado: excluir foto e desfazer — ${nome}`;
    const g = await gestosPagina(DESKTOP, FOTO_EXCLUIR);
    await abrirNaFotoA(g.page);
    await g.page.locator('#lightboxDelete').click();
    await g.page.waitForTimeout(200);
    const excluida = await fotosNoPedido(g.page);
    checa(excluida === 2, `${id}: PRÉ-CONDIÇÃO — a exclusão não tirou a foto da tela`, String(excluida));
    await desfazer(g);
    await g.page.waitForTimeout(3600);   // passa da janela: se não desfez, a exclusão SAIU
    checa(await fotosNoPedido(g.page) === 3, `${id}: a foto não voltou`);
    checa(exclusoesDeVerdade(g) === 0, `${id}: a exclusão SAIU pro Waze mesmo desfeita pelo teclado`);
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }
  {
    // CONTROLE: sem desfazer, a exclusão sai — senão "zero exclusão" seria vácuo.
    const id = 'gestos/teclado: CONTROLE — excluir sem desfazer';
    const g = await gestosPagina(DESKTOP, FOTO_EXCLUIR);
    await abrirNaFotoA(g.page);
    await g.page.locator('#lightboxDelete').click();
    await g.page.waitForTimeout(3600);
    checa(exclusoesDeVerdade(g) === 1, `${id}: a exclusão não saiu nem com a janela vencida`, JSON.stringify(g.saiu));
    await g.fechar();
  }
}

// ── O CARD: a saída que volta, o foco do teclado, a barra do foco e a trava ──
// ── que responde (auditoria do card, 2026-09-29) ───────────────────────────
//
//  C4  · a foto em decisão falhando sem rede durante os 350 ms da saída pelo ✕
//        deixava o card FORA da tela (x=-709, opacidade 0) como pedido atual,
//        com o ↑ inalcançável. Tem de VOLTAR, com o aviso da foto.
//  C10 · Enter no ✕ ↑ ✓ focado e no "Desfazer" largava o foco no <body>. Ele
//        vai ao botão equivalente do card novo (ou do devolvido) — e só pelo
//        teclado: o clique do mouse não move foco nenhum.
//  C11 · a barra do foco no autor diz "Tocar para voltar à ordem normal", e o
//        toque só a escondia. Tem de devolver a ordem sem trocar o card da tela.
//  C14 · o card travado sem banner (o "Marcar todos" no ar) não respondia ao
//        toque no ✕ (botão `disabled`), à seta nem ao arraste. Os três dizem
//        por quê, no máximo uma vez a cada 3 s, e o aviso sai quando a trava
//        acaba (no Fold ele cobre os botões).
//
// Roda nos DOIS motores (o foco e o ponteiro num botão `disabled` são coisa do
// motor). Cada item tem o CONTROLE ao lado: o mesmo caminho no caso que deve
// dar o contrário — senão um app com o gesto morto passaria verde.
{
  const CARD_L6 = { id: 1, userName: 'editor', rank: 5, isAreaManager: true, isStaff: false };
  const cardPedido = (id, extra = {}) => ({ ...JSON.parse(JSON.stringify(FIXTURES_PAISES[0])),
    venueID: 'v-' + id, updateRequestID: id, ...extra });
  // Uma página com a fila montada e a rede de mentira. `resposta(nome)` pode
  // devolver o corpo de uma rota (ou uma promessa dele); `foto` troca a rota
  // das fotos do Waze.
  async function cardPagina(fila, { viewport = { width: 393, height: 852 }, hasTouch = false, undo = true,
    resposta = null, foto = null } = {}) {
    const ctx = await browser.newContext({ viewport, hasTouch, serviceWorkers: 'block', locale: 'pt-BR' });
    await ctx.route('**/*-tiles/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_CINZA }));
    await ctx.route(/venue-image\.waze\.com/, foto
      || ((r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_CINZA })));
    await ctx.route('**/api/**', async (r) => {
      const nome = r.request().url().split('/api/')[1].split('?')[0];
      const feito = resposta ? await resposta(nome) : null;
      const resp = feito || { 'presenca-app': { success: true, online: [], conversas: [] },
        'lista-paises': { success: true, countries: [] }, 'lista-estados': { success: true, states: [] } }[nome]
        || { success: true };
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resp) }).catch(() => {});
    });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e.message || e)));
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    await page.evaluate(({ fila, perfil, undo }) => {
      setLang('pt');
      API.setSession('token-do-smoke-do-card');
      AppState.authenticated = true;
      AppState.profile = perfil;
      AppState.stats = { read: 0, rejected: 0, skipped: 0 };
      AppState.serverTotal = fila.length; AppState.hasMore = false;
      AppState.preferences.undoEnabled = undo;
      // Sem o Desfazer só depois da cota: o modo dev a libera (`canDisableUndo`).
      if (!undo) AppState.devMode = { unlocked: true, active: true };
      document.getElementById('authScreen').classList.add('hidden');
      document.getElementById('appScreen').classList.remove('hidden');
      document.getElementById('filtersBtn').classList.remove('hidden');
      renderProfileHeader(AppState.profile); updateStats(); showLoading(false);
      document.getElementById('noMoreCards').classList.add('hidden');
      document.querySelectorAll('.place-card').forEach((e) => e.remove());
      AppState.queue = fila.slice(); AppState.currentPlace = null; showCurrentPlace();
    }, { fila, perfil: CARD_L6, undo });
    await assentar(page, 250);
    return { ctx, page, erros, fechar: () => ctx.close() };
  }
  // Onde está o foco: o botão do card (e se é o da FRENTE), o Desfazer, ou o <body>.
  const focoAgora = (page) => page.evaluate(() => {
    const a = document.activeElement;
    const f = cardDaFrente();
    const cls = ['card-btn-reject', 'card-btn-skip', 'card-btn-read'].find((c) => a && a.classList && a.classList.contains(c));
    return { onde: !a || a === document.body ? 'body' : (cls || (a.id ? '#' + a.id : a.tagName)),
      naFrente: !!(a && f && f.contains(a)), frente: AppState.currentPlace && AppState.currentPlace.updateRequestID };
  });
  // A janela do Desfazer e o envio terminaram (é quando o foco prometido pousa).
  const acaoTerminou = () => !AppState.pendingAction && AppState.inFlightActions === 0 && !isSwipeAnimating();

  // ── C10: o foco de quem opera pelo teclado ──────────────────────────────
  for (const [nome, sel, cls, undo] of [
    ['✕, com a janela do Desfazer', '.card-btn-reject', 'card-btn-reject', true],
    ['↑, com a janela do Desfazer', '.card-btn-skip', 'card-btn-skip', true],
    ['✓, sem a janela', '.card-btn-read', 'card-btn-read', false],
  ]) {
    const id = `card/teclado ${MOTOR}: Enter no ${nome}`;
    const g = await cardPagina([cardPedido('kA'), cardPedido('kB'), cardPedido('kC')], { undo });
    await g.page.focus('#cardStack .place-card:not(.card-fundo) ' + sel);
    await g.page.keyboard.press('Enter');
    await esperarNaPagina(g.page, acaoTerminou, 8000);
    await doisQuadros(g.page);
    const f = await focoAgora(g.page);
    checa(f.frente === 'kB', `${id}: PRÉ-CONDIÇÃO — o Enter no botão focado não agiu`, JSON.stringify(f));
    checa(f.onde === cls && f.naFrente, `${id}: o foco não foi ao botão equivalente do card novo (caiu no <body>)`, JSON.stringify(f));
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }
  {
    // O Desfazer pelo teclado: o ✕ sai pelo MOUSE (sem pedido de foco nenhum),
    // e o Enter no "Desfazer" focado leva o foco ao ✕ do card devolvido.
    const id = `card/teclado ${MOTOR}: Enter no Desfazer`;
    const g = await cardPagina([cardPedido('kA'), cardPedido('kB')]);
    await g.page.click('#cardStack .place-card:not(.card-fundo) .card-btn-reject');
    await esperarOuExplodir(g.page, () => !!document.getElementById('undoBtn'), 'o banner do Desfazer');
    await g.page.focus('#undoBtn');
    await g.page.keyboard.press('Enter');
    await esperarNaPagina(g.page, acaoTerminou, 5000);
    await doisQuadros(g.page);
    const f = await focoAgora(g.page);
    checa(f.frente === 'kA', `${id}: PRÉ-CONDIÇÃO — o Desfazer não devolveu o pedido`, JSON.stringify(f));
    checa(f.onde === 'card-btn-reject' && f.naFrente, `${id}: o foco caiu no <body> em vez do ✕ do card devolvido`, JSON.stringify(f));
    await g.fechar();
  }
  {
    // CONTROLE: pelo MOUSE nada move o foco — nem o ✕, nem o Desfazer. É o que
    // separa "o foco vai ao card" de "o foco pula pela tela de quem usa o dedo".
    const id = `card/teclado ${MOTOR}: CONTROLE — o mouse não move o foco`;
    const g = await cardPagina([cardPedido('kA'), cardPedido('kB'), cardPedido('kC')]);
    await g.page.click('#cardStack .place-card:not(.card-fundo) .card-btn-reject');
    await esperarOuExplodir(g.page, () => !!document.getElementById('undoBtn'), 'o banner do Desfazer');
    await g.page.click('#undoBtn');
    await esperarNaPagina(g.page, acaoTerminou, 5000);
    await doisQuadros(g.page);
    const d = await focoAgora(g.page);
    checa(d.frente === 'kA', `${id}: PRÉ-CONDIÇÃO — o Desfazer pelo mouse não devolveu o pedido`, JSON.stringify(d));
    checa(!(d.onde.startsWith('card-btn') && d.naFrente), `${id}: o Desfazer pelo mouse pôs o foco no card`, JSON.stringify(d));
    await g.page.click('#cardStack .place-card:not(.card-fundo) .card-btn-reject');
    await esperarNaPagina(g.page, acaoTerminou, 8000);
    await doisQuadros(g.page);
    const f = await focoAgora(g.page);
    checa(f.frente === 'kB', `${id}: PRÉ-CONDIÇÃO — o ✕ pelo mouse não agiu`, JSON.stringify(f));
    checa(!(f.onde.startsWith('card-btn') && f.naFrente), `${id}: o clique do mouse pôs o foco no card novo`, JSON.stringify(f));
    await g.fechar();
  }

  // ── R7-2-06: o botão que some com o ÚLTIMO card, e o fim da fila ─────────
  // O C10 leva o foco ao botão equivalente do card que CHEGA — e, quando a
  // decisão esvaziava a fila, não chegava card nenhum: o foco caía no <body>, e
  // nenhuma região viva mudava (auditoria de 2026-10-02, R7-2-06). O foco vai ao
  // "Verificar novamente" do painel, e o título dele é dito pela região do card.
  // Com a janela do Desfazer o foco ESPERA: a tecla z devolve o card, e o foco
  // vai ao ✕ dele. CONTROLE: pelo mouse o foco não pula, e o fim é dito igual.
  const ouvirRegiaoDoCard = (page) => page.evaluate(() => {
    window.__ditosDoCard = [];
    const r = document.getElementById('cardLiveRegion');
    new MutationObserver(() => window.__ditosDoCard.push(r.textContent))
      .observe(r, { childList: true, characterData: true, subtree: true });
  });
  const fimDaFila = (page) => page.evaluate(() => ({
    painel: !document.getElementById('noMoreCards').classList.contains('hidden'),
    titulo: document.querySelector('#noMoreCards h3').textContent.trim(), ditos: window.__ditosDoCard }));
  for (const [nome, sel, undo, titulo] of [
    ['✕ do ÚLTIMO, com a janela do Desfazer', '.card-btn-reject', true, 'Tudo limpo!'],
    ['↑ do ÚLTIMO, sem a janela', '.card-btn-skip', false, 'Fim da fila'],
  ]) {
    const id = `card/teclado ${MOTOR}: Enter no ${nome}`;
    const g = await cardPagina([cardPedido('kA')], { undo });
    await ouvirRegiaoDoCard(g.page);
    await g.page.focus('#cardStack .place-card:not(.card-fundo) ' + sel);
    await g.page.keyboard.press('Enter');
    await esperarNaPagina(g.page, acaoTerminou, 8000);
    await doisQuadros(g.page);
    const f = await focoAgora(g.page);
    const d = await fimDaFila(g.page);
    checa(d.painel && !f.frente && d.titulo === titulo, `${id}: PRÉ-CONDIÇÃO — a fila não acabou no painel "${titulo}"`, JSON.stringify({ f, d }));
    checa(f.onde === '#reloadBtn', `${id}: DEFEITO — a fila acabou pelo teclado e o foco ficou em ${f.onde}, não no "Verificar novamente"`, JSON.stringify(f));
    checa(d.ditos.at(-1) === titulo, `${id}: o fim da fila não foi dito pela região do card`, JSON.stringify(d.ditos));
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }
  {
    // A tecla z DENTRO da janela: o card volta, e o foco vai ao ✕ dele. Se o
    // painel tomasse o foco na hora (antes de a janela acabar), o z o largava
    // escondido junto com o painel.
    const id = `card/teclado ${MOTOR}: Enter no ✕ do ÚLTIMO e a tecla z na janela`;
    const g = await cardPagina([cardPedido('kA')]);
    await g.page.focus('#cardStack .place-card:not(.card-fundo) .card-btn-reject');
    await g.page.keyboard.press('Enter');
    await esperarOuExplodir(g.page, () => !!document.getElementById('undoBtn'), 'o banner do Desfazer');
    const naJanela = await focoAgora(g.page);
    await g.page.keyboard.press('z');
    await esperarNaPagina(g.page, acaoTerminou, 5000);
    await doisQuadros(g.page);
    const f = await focoAgora(g.page);
    checa(naJanela.onde !== '#reloadBtn', `${id}: o foco foi pro painel com a janela do Desfazer correndo`, JSON.stringify(naJanela));
    checa(f.frente === 'kA', `${id}: PRÉ-CONDIÇÃO — a tecla z não devolveu o pedido`, JSON.stringify(f));
    checa(f.onde === 'card-btn-reject' && f.naFrente, `${id}: o foco não voltou ao ✕ do card devolvido`, JSON.stringify(f));
    await g.fechar();
  }
  {
    // CONTROLE: pelo MOUSE o foco não pula pro painel — e o fim é dito do mesmo
    // jeito (o anúncio é de quem usa leitor de tela, com o dedo também).
    const id = `card/teclado ${MOTOR}: CONTROLE — o ✕ do ÚLTIMO pelo mouse`;
    const g = await cardPagina([cardPedido('kA')], { undo: false });
    await ouvirRegiaoDoCard(g.page);
    await g.page.click('#cardStack .place-card:not(.card-fundo) .card-btn-reject');
    await esperarNaPagina(g.page, acaoTerminou, 8000);
    await doisQuadros(g.page);
    const f = await focoAgora(g.page);
    const d = await fimDaFila(g.page);
    checa(d.painel && !f.frente, `${id}: PRÉ-CONDIÇÃO — o ✕ pelo mouse não esvaziou a fila`, JSON.stringify({ f, d }));
    checa(f.onde !== '#reloadBtn', `${id}: o clique do mouse pôs o foco no painel (o foco pulando pela tela)`, JSON.stringify(f));
    checa(d.ditos.at(-1) === 'Tudo limpo!', `${id}: o fim da fila não foi dito a quem usa o mouse ou o dedo`, JSON.stringify(d.ditos));
    await g.fechar();
  }

  // ── C4: a foto em decisão falha no meio da saída pelo ✕ ─────────────────
  for (const falha of [true, false]) {
    const id = `card/foto ${MOTOR}: ${falha ? '' : 'CONTROLE — '}a foto em decisão ${falha ? 'FALHA' : 'chega'} durante a saída pelo ✕`;
    let soltar = null, pedidosDaFoto = 0;
    // A 1ª ida da foto do pedido em decisão fica PRESA até o teste soltar: é o
    // que põe a falha no MEIO dos 350 ms da saída, e não "mais ou menos".
    const foto = async (r) => {
      if (!r.request().url().includes('thumb700_fA')) {
        return r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_CINZA }).catch(() => {});
      }
      pedidosDaFoto++;
      if (pedidosDaFoto === 1) await new Promise((ok) => { soltar = ok; });
      if (falha) return r.abort('internetdisconnected').catch(() => {});
      return r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_CINZA }).catch(() => {});
    };
    const g = await cardPagina([gestosPedidoDeFoto('fA'), gestosPedidoDeFoto('fB')], { foto });
    await esperarOuExplodir(g.page, () => true, 'a página');
    // Sem rede pro app: o aviso da foto só nasce com `onLine === false` (a
    // simulação do modo avião do Playwright muda de motor pra motor; aqui só o
    // sinal que o app lê, e a falha vem da rota).
    await g.page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
    await g.page.click('#cardStack .place-card:not(.card-fundo) .card-btn-reject');
    await g.page.waitForTimeout(120);
    const saindo = await g.page.evaluate(() => isSwipeAnimating());
    checa(saindo && !!soltar, `${id}: PRÉ-CONDIÇÃO — a foto não ficou presa até o meio da saída`, `saindo=${saindo} presa=${!!soltar}`);
    if (soltar) soltar();
    await esperarNaPagina(g.page, () => !isSwipeAnimating() && !!cardDaFrente(), 3000);
    await g.page.waitForTimeout(400);   // a 2ª ida da foto (remontado) falha também
    const m = await g.page.evaluate(() => {
      const c = cardDaFrente();
      const r = c.getBoundingClientRect();
      const skip = c.querySelector('.card-btn-skip').getBoundingClientRect();
      const e = document.elementFromPoint(skip.x + skip.width / 2, skip.y + skip.height / 2);
      return { frente: AppState.currentPlace && AppState.currentPlace.updateRequestID,
        janela: AppState.pendingAction ? AppState.pendingAction.type : null, rejeitados: AppState.stats.rejected,
        x: Math.round(r.x), largura: innerWidth, opacidade: getComputedStyle(c).opacity,
        semFoto: !!c.querySelector('.card-sem-foto'), rejeitarTravado: c.querySelector('.card-btn-reject').disabled,
        pularAlcancavel: !!(e && e.closest('.card-btn-skip') && c.contains(e)) };
    });
    if (falha) {
      checa(m.frente === 'fA' && m.rejeitados === 0 && !m.janela, `${id}: rejeitou uma foto que ninguém viu`, JSON.stringify(m));
      checa(m.x >= 0 && m.x < m.largura && m.opacidade === '1',
        `${id}: DEFEITO — o card ficou FORA da tela (o pedido na frente, invisível)`, JSON.stringify(m));
      checa(m.semFoto && m.rejeitarTravado, `${id}: o card voltou sem o aviso da foto que precisa de sinal`, JSON.stringify(m));
      checa(m.pularAlcancavel, `${id}: o ↑ não está ao alcance do dedo`, JSON.stringify(m));
    } else {
      checa(m.frente === 'fB' && m.janela === 'reject' && m.rejeitados === 1,
        `${id}: com a foto chegando, o ✕ deixou de agir`, JSON.stringify(m));
    }
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }

  // ── C11: o toque na barra do foco volta à ordem normal ─────────────────
  {
    const id = `card/foco no autor ${MOTOR}: tocar na barra volta à ordem normal`;
    const P = (x, autor, data) => cardPedido(x, { creatorId: autor, createdBy: 'autor' + autor, dateAdded: data });
    const g = await cardPagina([P('X1', 7, 5000), P('Y1', 8, 4000), P('X2', 7, 3000), P('Y2', 8, 2000), P('X3', 7, 1000)]);
    await g.page.click('#cardStack .place-card:not(.card-fundo) .selo-lote');
    await assentar(g.page);
    const fila = () => g.page.evaluate(() => AppState.queue.map((p) => p.updateRequestID).join(','));
    const focada = await fila();
    checa(focada === 'X1,X2,X3,Y1,Y2', `${id}: PRÉ-CONDIÇÃO — o "Ver +N" não pôs a série do autor na frente`, focada);
    // O card da tela ganha uma marca: se o toque o TROCAR, a marca some.
    await g.page.evaluate(() => { cardDaFrente().dataset.marcaDoSmoke = '1'; });
    await g.page.click('#focoAutorBar');
    await assentar(g.page);
    const d = await g.page.evaluate(() => ({
      barra: !document.getElementById('focoAutorBar').classList.contains('hidden'),
      mesmoCard: cardDaFrente() && cardDaFrente().dataset.marcaDoSmoke === '1',
      frente: AppState.currentPlace && AppState.currentPlace.updateRequestID,
      fundo: (document.querySelector('#cardStack .card-fundo') || { dataset: {} }).dataset.pedido || null,
      quer: chaveDoPedido(AppState.queue[1]),
    }));
    checa(await fila() === 'X1,Y1,X2,Y2,X3', `${id}: DEFEITO — o toque só escondeu a barra; a série do autor seguiu na frente`, await fila());
    checa(!d.barra, `${id}: a barra seguiu na tela`, JSON.stringify(d));
    checa(d.frente === 'X1' && d.mesmoCard, `${id}: o toque TROCOU o card da tela`, JSON.stringify(d));
    checa(d.fundo === d.quer, `${id}: o card de fundo segue anunciando o pedido da série`, JSON.stringify(d));
    // CONTROLE do foco: pelo MOUSE a barra não move o foco pro "Ver +N".
    const pelMouse = await g.page.evaluate(() => { const a = document.activeElement; return !!(a && a.classList && a.classList.contains('selo-lote')); });
    checa(!pelMouse, `${id}: CONTROLE — o clique do mouse na barra pôs o foco no "Ver +N"`);
    // Pelo TECLADO (a família do C10): Enter no "Ver +N" e Enter na barra
    // largavam o foco no <body> — o card é remontado, a barra se esconde.
    const idT = `card/foco no autor ${MOTOR}: pelo teclado o foco não cai no <body>`;
    await g.page.focus('#cardStack .place-card:not(.card-fundo) .selo-lote');
    await g.page.keyboard.press('Enter');
    await assentar(g.page);
    const naBarra = await g.page.evaluate(() => ({ foco: (document.activeElement || {}).id || null,
      fila: AppState.queue.map((p) => p.updateRequestID).join(',') }));
    checa(naBarra.fila === 'X1,X2,X3,Y1,Y2', `${idT}: PRÉ-CONDIÇÃO — o Enter no "Ver +N" não pôs a série na frente`, JSON.stringify(naBarra));
    checa(naBarra.foco === 'focoAutorBar', `${idT}: Enter no "Ver +N" largou o foco (devia ir à barra, o caminho de volta)`, JSON.stringify(naBarra));
    await g.page.focus('#focoAutorBar');
    await g.page.keyboard.press('Enter');
    await assentar(g.page);
    const noSelo = await g.page.evaluate(() => {
      const a = document.activeElement;
      return { selo: !!(a && a.classList && a.classList.contains('selo-lote') && cardDaFrente() && cardDaFrente().contains(a)),
        fila: AppState.queue.map((p) => p.updateRequestID).join(',') };
    });
    checa(noSelo.fila === 'X1,Y1,X2,Y2,X3', `${idT}: PRÉ-CONDIÇÃO — o Enter na barra não voltou à ordem normal`, JSON.stringify(noSelo));
    checa(noSelo.selo, `${idT}: Enter na barra largou o foco (devia ir ao "Ver +N" do card da tela)`, JSON.stringify(noSelo));
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }

  // ── R12-2-06: a série do autor ACABA com o card dele na tela ────────────
  // Com o foco no autor, a OUTRA aba decide a série inteira (o "Marcar todos"
  // de lá): o card da tela, decidido lá, fica fora da série (R11-2-06) e na
  // frente — e a barra dizia "Primeiro os de X · 0 de 3", com o leitor de tela
  // ouvindo "os 0 pedidos" (roteiro e13 da rodada 12). A barra SOME, o foco no
  // autor sai, e o foco do TECLADO que estava nela vai ao ✕ do card, nunca ao
  // <body>. O aviso da outra aba entra pelo caminho de verdade
  // (`aoPousarEmOutraAba`, o que o canal dos pousos entrega). CONTROLES: a
  // outra aba decide só o pedido de TRÁS (a série segue com o card da tela, e a
  // barra fica, contando, com o foco nela); e pelo MOUSE a barra some sem mover
  // foco nenhum.
  for (const caso of ['serie', 'controle', 'mouse']) {
    const id = `card/foco no autor ${MOTOR}: ${caso === 'serie' ? '' : 'CONTROLE — '}${
      { serie: 'a outra aba decide a série INTEIRA', controle: 'a outra aba decide só o de trás', mouse: 'a série inteira, pelo mouse' }[caso]}`;
    const P = (x, autor, data) => cardPedido(x, { creatorId: autor, createdBy: 'autor' + autor, dateAdded: data });
    const g = await cardPagina([P('Z1', 7, 5000), P('W1', 8, 4000), P('Z2', 7, 3000), P('W2', 8, 2000)]);
    // O foco no autor 7: pelo TECLADO (Enter no "Ver +1" leva o foco à barra, C10) ou pelo MOUSE.
    if (caso === 'mouse') await g.page.click('#cardStack .place-card:not(.card-fundo) .selo-lote');
    else {
      await g.page.focus('#cardStack .place-card:not(.card-fundo) .selo-lote');
      await g.page.keyboard.press('Enter');
    }
    await assentar(g.page);
    const antes = await g.page.evaluate(() => ({ foco: (document.activeElement || {}).id || null,
      fila: AppState.queue.map((p) => p.updateRequestID).join(','),
      barra: !document.getElementById('focoAutorBar').classList.contains('hidden'),
      contagem: document.getElementById('focoAutorContagem').textContent }));
    checa(antes.fila === 'Z1,Z2,W1,W2' && antes.barra && antes.contagem === '2 de 4',
      `${id}: PRÉ-CONDIÇÃO — o "Ver +1" não pôs a série na frente com a barra "2 de 4"`, JSON.stringify(antes));
    if (caso !== 'mouse') checa(antes.foco === 'focoAutorBar', `${id}: PRÉ-CONDIÇÃO — o foco não está na barra`, JSON.stringify(antes));
    // O aviso da outra aba: a série inteira (o card da tela incluído), ou só o de trás.
    await g.page.evaluate((soODeTras) => {
      const ps = AppState.queue.filter((p) => (soODeTras ? p.updateRequestID === 'Z2' : p.creatorId === 7));
      aoPousarEmOutraAba({ v: 1, chaves: ps.map(chaveDoPedido), s: marcaDaSessao(API.getSession()) });
    }, caso === 'controle');
    await assentar(g.page);
    const d = await g.page.evaluate(() => {
      const b = document.getElementById('focoAutorBar');
      const a = document.activeElement;
      const f = cardDaFrente();
      return { barra: !b.classList.contains('hidden'), contagem: document.getElementById('focoAutorContagem').textContent,
        aria: b.getAttribute('aria-label'), autor: AppState.autorEmFoco,
        fila: AppState.queue.map((p) => p.updateRequestID).join(','), frente: AppState.currentPlace && AppState.currentPlace.updateRequestID,
        foco: !a || a === document.body ? 'body'
          : (a.id ? '#' + a.id : ([...a.classList].find((c) => c.startsWith('card-btn-')) || a.tagName)),
        focoNaFrente: !!(a && f && f.contains(a)) };
    });
    checa(d.fila === 'Z1,W1,W2' && d.frente === 'Z1', `${id}: PRÉ-CONDIÇÃO — o aviso não tirou o de trás (ou trocou o da tela)`, JSON.stringify(d));
    if (caso === 'controle') {
      checa(d.barra && d.contagem === '1 de 3' && d.autor === 7, `${id}: com a série viva, a barra saiu (ou deixou de contar)`, JSON.stringify(d));
      checa(d.foco === '#focoAutorBar', `${id}: o foco saiu da barra que ficou`, JSON.stringify(d));
    } else {
      checa(!d.barra, `${id}: DEFEITO — a barra seguiu na tela com a série VAZIA ("${d.contagem}", "${d.aria}")`, JSON.stringify(d));
      checa(d.autor === null, `${id}: a série acabou e o foco no autor seguiu ligado`, JSON.stringify(d));
      if (caso === 'serie') {
        checa(d.foco === 'card-btn-reject' && d.focoNaFrente, `${id}: a barra sumiu com o foco nela e ele não foi ao ✕ do card`, JSON.stringify(d));
      } else {
        checa(d.foco !== 'card-btn-reject', `${id}: pelo mouse, a barra que sumiu levou o foco ao ✕`, JSON.stringify(d));
      }
    }
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }

  // ── R13-2-05: a série do autor ACABA pela seta, com o foco na barra ────
  // O Enter no "Ver +1" leva o foco à barra (C10), e as setas decidem com ele
  // ali. Quando o último pedido do autor saía e o próximo card era de OUTRO
  // autor, a barra se escondia com o foco nela, e ele caía no <body> — pela seta
  // e pelo `triggerSwipe`, o caminho do gesto e do botão (MEDIDO nos dois
  // motores, roteiro c1 da rodada 13). E quando o último dele era o FIM da fila
  // a barra nem saía: ficava sobre o "Tudo limpo!" dizendo "1 de 1", com o foco
  // nela. Agora o foco vai ao caminho de volta no card novo (o "Ver +N" dele, ou
  // o ✕), ou ao "Verificar novamente"; e o Desfazer do último devolve a barra
  // junto com o pedido, com o foco no ✕ dele. CONTROLES: a seta com a série
  // ainda viva mantém a barra e o foco nela; e pelo MOUSE o fim da fila tira a
  // barra sem mover foco nenhum.
  for (const caso of ['seta', 'botao', 'fim', 'desfazer', 'controle', 'mouse']) {
    const id = `card/foco no autor ${MOTOR}: ${caso === 'controle' || caso === 'mouse' ? 'CONTROLE — ' : ''}${{
      seta: 'a seta decide o último do autor (o próximo é de outro)', botao: 'o gesto decide o último do autor',
      fim: 'a seta decide o último do autor, o fim da fila', desfazer: 'o Desfazer do último do autor, o fim da fila',
      controle: 'a seta com a série ainda viva', mouse: 'o fim da fila pelo mouse' }[caso]}`;
    const P = (x, autor) => cardPedido(x, { creatorId: autor, createdBy: 'autor' + autor });
    const doFim = caso === 'fim' || caso === 'desfazer' || caso === 'mouse';
    const g = await cardPagina(doFim ? [P('Z1', 7), P('Z2', 7)] : [P('Z1', 7), P('W1', 8), P('Z2', 7), P('W2', 8)],
      { undo: caso === 'desfazer' });
    const estadoAgora = () => g.page.evaluate(() => {
      const b = document.getElementById('focoAutorBar');
      const a = document.activeElement;
      const f = cardDaFrente();
      return { barra: !b.classList.contains('hidden'), contagem: document.getElementById('focoAutorContagem').textContent,
        autor: AppState.autorEmFoco, frente: AppState.currentPlace && AppState.currentPlace.updateRequestID,
        fila: AppState.queue.map((p) => p.updateRequestID).join(','),
        fim: !document.getElementById('noMoreCards').classList.contains('hidden'),
        foco: !a || a === document.body ? 'body'
          : (a.id ? '#' + a.id : ([...a.classList].find((c) => c.startsWith('card-btn-') || c === 'selo-lote') || a.tagName)),
        focoNaFrente: !!(a && f && f.contains(a)) };
    });
    // O foco no autor 7: pelo TECLADO (Enter no "Ver +1" leva o foco à barra) ou pelo MOUSE.
    if (caso === 'mouse') await g.page.click('#cardStack .place-card:not(.card-fundo) .selo-lote');
    else {
      await g.page.focus('#cardStack .place-card:not(.card-fundo) .selo-lote');
      await g.page.keyboard.press('Enter');
    }
    await assentar(g.page);
    const antes = await estadoAgora();
    checa(antes.barra && antes.autor === 7 && antes.fila === (doFim ? 'Z1,Z2' : 'Z1,Z2,W1,W2'),
      `${id}: PRÉ-CONDIÇÃO — o "Ver +1" não pôs a série do autor 7 na frente com a barra`, JSON.stringify(antes));
    if (caso !== 'mouse') checa(antes.foco === '#focoAutorBar', `${id}: PRÉ-CONDIÇÃO — o foco não está na barra`, JSON.stringify(antes));
    // Uma decisão no card da frente: pela seta (o foco SEGUE na barra), pelo
    // `triggerSwipe` (o caminho do gesto e do botão) ou pelo ✕ do mouse.
    const decidir = async () => {
      if (caso === 'mouse') await g.page.click('#cardStack .place-card:not(.card-fundo) .card-btn-reject');
      else if (caso === 'botao') {
        await g.page.focus('#focoAutorBar');
        await g.page.evaluate(() => window.triggerSwipe('left', (card) => agirNoPedidoDoGesto(pedidoDoCard(card), handleReject)));
      } else await g.page.keyboard.press('ArrowLeft');
    };
    await decidir();
    await esperarNaPagina(g.page, acaoTerminou, 8000);
    await doisQuadros(g.page);
    const meio = await estadoAgora();
    checa(meio.frente === 'Z2' && meio.barra && meio.contagem === (doFim ? '1 de 1' : '1 de 3'),
      `${id}: PRÉ-CONDIÇÃO — a 1ª decisão não deixou o último do autor na frente, com a barra contando`, JSON.stringify(meio));
    if (caso === 'controle') {
      checa(meio.foco === '#focoAutorBar', `${id}: com a série viva, o foco saiu da barra`, JSON.stringify(meio));
      checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
      await g.fechar();
      continue;
    }
    await decidir();
    if (caso === 'desfazer') {
      // Na janela do Desfazer do último: a tecla z devolve o pedido.
      await esperarOuExplodir(g.page, () => !!AppState.pendingAction, 'a janela do Desfazer do último pedido');
      await doisQuadros(g.page);
      const naJanela = await estadoAgora();
      checa(!naJanela.barra && naJanela.fim, `${id}: na janela, a barra seguiu sobre o "Tudo limpo!"`, JSON.stringify(naJanela));
      await g.page.keyboard.press('z');
    }
    await esperarNaPagina(g.page, acaoTerminou, 8000);
    await doisQuadros(g.page);
    const d = await estadoAgora();
    if (caso === 'seta' || caso === 'botao') {
      checa(d.frente === 'W1' && !d.barra && d.autor === null, `${id}: a série acabou e a barra (ou o foco no autor) ficou`, JSON.stringify(d));
      checa(d.foco === 'selo-lote' && d.focoNaFrente,
        `${id}: DEFEITO — a barra sumiu com o foco nela e ele não foi ao "Ver +N" do card novo (caiu em ${d.foco})`, JSON.stringify(d));
    } else if (caso === 'fim') {
      checa(d.fim && !d.barra, `${id}: DEFEITO — a barra ficou sobre o "Tudo limpo!" dizendo "${d.contagem}"`, JSON.stringify(d));
      checa(d.autor === 7, `${id}: o foco no autor saiu sem card (o Desfazer do último não devolveria a barra)`, JSON.stringify(d));
      checa(d.foco === '#reloadBtn', `${id}: o foco do teclado não foi ao "Verificar novamente" (está em ${d.foco})`, JSON.stringify(d));
    } else if (caso === 'desfazer') {
      checa(d.frente === 'Z2' && d.barra && d.contagem === '1 de 1' && d.autor === 7,
        `${id}: o Desfazer devolveu o último pedido do autor e a barra não voltou`, JSON.stringify(d));
      checa(d.foco === 'card-btn-reject' && d.focoNaFrente, `${id}: o foco não foi ao ✕ do pedido devolvido (está em ${d.foco})`, JSON.stringify(d));
    } else {
      checa(d.fim && !d.barra, `${id}: DEFEITO — a barra ficou sobre o "Tudo limpo!" dizendo "${d.contagem}"`, JSON.stringify(d));
      checa(d.foco !== '#reloadBtn', `${id}: pelo mouse, o fim da fila levou o foco ao "Verificar novamente"`, JSON.stringify(d));
    }
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }

  // ── A foto que falha DEPOIS de o foco do teclado pousar no ✕ ────────────
  // A família do C10: o foco pousa no ✕ do card novo (o de FOTO, ainda
  // carregando), a foto falha sem rede, a `marcarCardSemFoto` trava ✕ e ✓ — e o
  // ✕ focado que vira `disabled` perdia o foco pro <body> (medido nos dois
  // motores). Tem de ir ao ↑. CONTROLE: com a foto chegando, o foco fica no ✕.
  for (const falha of [true, false]) {
    const id = `card/foco ${MOTOR}: ${falha ? '' : 'CONTROLE — '}a foto ${falha ? 'FALHA' : 'chega'} depois de o foco pousar no ✕`;
    let soltar = null;
    const foto = async (r) => {
      if (r.request().url().includes('thumb700_fF')) {
        await new Promise((ok) => { soltar = ok; });
        if (falha) return r.abort('internetdisconnected').catch(() => {});
      }
      return r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_CINZA }).catch(() => {});
    };
    const g = await cardPagina([cardPedido('fA'), gestosPedidoDeFoto('fF'), cardPedido('fC')], { undo: false, foto });
    await g.page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
    await g.page.focus('#cardStack .place-card:not(.card-fundo) .card-btn-reject');
    await g.page.keyboard.press('Enter');
    await esperarNaPagina(g.page, () => AppState.currentPlace && AppState.currentPlace.updateRequestID === 'fF'
      && !isSwipeAnimating() && AppState.inFlightActions === 0, 5000);
    await doisQuadros(g.page);
    const antes = await focoAgora(g.page);
    checa(antes.frente === 'fF' && antes.onde === 'card-btn-reject' && antes.naFrente && !!soltar,
      `${id}: PRÉ-CONDIÇÃO — o foco não pousou no ✕ do card de foto com a foto ainda carregando`, JSON.stringify(antes));
    if (soltar) soltar();
    await esperarNaPagina(g.page, () => {
      const c = cardDaFrente();
      return !!c && (!!c.querySelector('.card-sem-foto') || !!c.querySelector('.card-image:not(.hidden)'));
    }, 5000);
    await doisQuadros(g.page);
    const depois = await focoAgora(g.page);
    const semFoto = await g.page.evaluate(() => !!cardDaFrente().querySelector('.card-sem-foto'));
    if (falha) {
      checa(semFoto, `${id}: PRÉ-CONDIÇÃO — o card não ficou sem a foto`);
      checa(depois.onde === 'card-btn-skip' && depois.naFrente,
        `${id}: DEFEITO — o ✕ travou com o foco nele e o foco caiu no <body> (devia ir ao ↑)`, JSON.stringify(depois));
    } else {
      checa(!semFoto && depois.onde === 'card-btn-reject' && depois.naFrente,
        `${id}: com a foto chegando o foco saiu do ✕`, JSON.stringify(depois));
    }
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }

  // ── C14: o card travado pelo lote diz por quê ─────────────────────────
  {
    const id = `card/trava ${MOTOR}: o card travado pelo "Marcar todos" responde`;
    // O lote fica PRESO até o teste soltar; soltando, ele FALHA (o Waze fora):
    // os pedidos seguem na fila e o card destrava com eles.
    let soltarLote = null, falharLote = false, primeira = true;
    const resposta = async (nome) => {
      if (nome !== 'marcar-lido') return null;
      if (primeira) { primeira = false; await new Promise((ok) => { soltarLote = ok; }); }
      return falharLote ? { success: false, error: 'x', errorCategory: 'unknown' } : { success: true };
    };
    const g = await cardPagina(Array.from({ length: 6 }, (_, i) => cardPedido('t' + i)),
      { viewport: { width: 280, height: 653 }, hasTouch: true, resposta });
    // Os toasts somem em 4 s: um observador conta cada um que ENTRA.
    await g.page.evaluate(() => {
      window.__toastsDoSmoke = [];
      new MutationObserver((ms) => {
        for (const m of ms) for (const n of m.addedNodes) {
          if (n.classList && n.classList.contains('toast')) window.__toastsDoSmoke.push(n.textContent.trim());
        }
      }).observe(document.getElementById('toastContainer'), { childList: true });
    });
    const texto = await g.page.evaluate(() => t('toast.esperaLote'));
    const avisos = () => g.page.evaluate((x) => window.__toastsDoSmoke.filter((s) => s === x).length, texto);
    const centro = (sel) => g.page.evaluate((s) => {
      const r = cardDaFrente().querySelector(s).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, sel);
    await g.page.evaluate(() => { openBatchReadConfirm(); handleBatchMarkRead(); });
    await esperarOuExplodir(g.page, () => acoesTravadas() && !!cardDaFrente()
      && cardDaFrente().querySelector('.card-btn-reject').disabled, 'o lote travar o card');
    // O "Marcando 6 como lidos…" FICA enquanto o lote está no ar (R14-8-10):
    // como aviso solto de 4 s, ele sumia no meio do lote lento (e no rápido ficava
    // junto do "6 marcados"). Passados os 4 s, com o lote PRESO, ele segue lá.
    const marcando = await g.page.evaluate(() => t('toast.batchMarkingPlural', { n: 6 }));
    await g.page.waitForTimeout(4500);
    const naTelaAos45 = await g.page.evaluate((x) => [...document.querySelectorAll('#toastContainer .toast')]
      .some((e) => e.textContent.trim() === x && e.style.opacity !== '0'), marcando);
    checa(naTelaAos45, `${id}: DEFEITO — o "Marcando 6 como lidos…" sumiu com o lote no ar (R14-8-10)`);
    // No Fold ele cobre os botões: tocar ali é tocar no aviso (medido — o 1º
    // toque do teste caía nele), e o toque o dispensa. O caso do relato é DEPOIS
    // que ele sai.
    if (naTelaAos45) await g.page.click('#toastContainer .toast');
    await esperarOuExplodir(g.page, () => !document.querySelector('#toastContainer .toast'), 'o toast do lote sair', 8000);
    // 1) o TOQUE no ✕ travado: botão `disabled` não recebe `click`, e a
    //    barra ouve o pointerdown/up.
    const x = await centro('.card-btn-reject');
    const alvo = await g.page.evaluate(({ x, y }) => {
      const e = document.elementFromPoint(x, y);
      return !!(e && e.closest('.card-btn-reject') && e.closest('.card-btn-reject').disabled);
    }, x);
    checa(alvo, `${id}: PRÉ-CONDIÇÃO — o dedo não chega ao ✕ travado (algo o cobre)`);
    await g.page.touchscreen.tap(x.x, x.y);
    await g.page.waitForTimeout(300);
    checa(await avisos() === 1, `${id}: DEFEITO — o toque no ✕ travado não respondeu`, `${await avisos()} avisos`);
    // 2) a seta dentro do intervalo NÃO empilha outro aviso; passado ele, responde.
    await g.page.keyboard.press('ArrowLeft');
    await g.page.waitForTimeout(200);
    checa(await avisos() === 1, `${id}: a seta em menos de 3 s empilhou outro aviso`, `${await avisos()} avisos`);
    await g.page.waitForTimeout(3000);
    await g.page.keyboard.press('ArrowLeft');
    await g.page.waitForTimeout(200);
    checa(await avisos() === 2, `${id}: a seta no card travado voltou calada`, `${await avisos()} avisos`);
    // 3) o ARRASTE (mouse, pelo nome do local — nem botão, nem foto).
    await g.page.waitForTimeout(3000);
    const n = await centro('.card-name');
    await g.page.mouse.move(n.x, n.y);
    await g.page.mouse.down();
    await g.page.mouse.move(n.x - 120, n.y, { steps: 8 });
    await g.page.mouse.up();
    await g.page.waitForTimeout(200);
    checa(await avisos() === 3, `${id}: arrastar o card travado voltou calado`, `${await avisos()} avisos`);
    const nada = await g.page.evaluate(() => ({ rejeitados: AppState.stats.rejected, janela: !!AppState.pendingAction,
      transform: cardDaFrente().style.transform || '' }));
    checa(nada.rejeitados === 0 && !nada.janela && !/translate\(-/.test(nada.transform),
      `${id}: o card travado decidiu (ou saiu do lugar)`, JSON.stringify(nada));
    // 4) o aviso SAI quando a trava acaba: "espere o lote terminar" com o lote
    //    terminado é o app mentindo — e no Fold ele cobre ✕ ↑ ✓.
    await g.page.waitForTimeout(3000);
    await g.page.keyboard.press('ArrowLeft');
    await g.page.waitForTimeout(300);
    const naTela = () => g.page.evaluate((x) => [...document.querySelectorAll('#toastContainer .toast')]
      .filter((e) => e.textContent.trim() === x && e.style.opacity !== '0').length, texto);
    const cobre = await g.page.evaluate(() => {
      const r = cardDaFrente().querySelector('.card-btn-reject').getBoundingClientRect();
      const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!(e && e.closest('.toast'));
    });
    const avisosNaTela = await naTela();
    checa(cobre && avisosNaTela === 1,
      `${id}: PRÉ-CONDIÇÃO — o aviso não está na tela (UM só) cobrindo o ✕ no Fold (o "sai quando acaba" não mediria nada)`,
      `cobre=${cobre} na tela=${avisosNaTela}`);
    falharLote = true;
    if (soltarLote) soltarLote();
    await esperarNaPagina(g.page, () => !acoesTravadas(), 8000);
    await g.page.waitForTimeout(400);   // a saída do toast (0,25 s)
    const depois = await g.page.evaluate(() => ({ travado: acoesTravadas(), card: !!cardDaFrente() }));
    checa(!depois.travado && depois.card, `${id}: PRÉ-CONDIÇÃO — o lote falhando não destravou o card`, JSON.stringify(depois));
    checa(await naTela() === 0, `${id}: a trava acabou e o aviso "espere…" seguiu na tela (e cobrindo o ✕ no Fold)`);
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }
  {
    // CONTROLE: na janela do Desfazer o banner com a contagem já explica — o
    // toque no ✕ travado NÃO ganha aviso nenhum.
    const id = `card/trava ${MOTOR}: CONTROLE — a janela do Desfazer não ganha aviso`;
    const g = await cardPagina([cardPedido('w1'), cardPedido('w2')], { viewport: { width: 280, height: 653 }, hasTouch: true });
    await g.page.evaluate(() => {
      window.__toastsDoSmoke = [];
      new MutationObserver((ms) => {
        for (const m of ms) for (const n of m.addedNodes) {
          if (n.classList && n.classList.contains('toast')) window.__toastsDoSmoke.push(n.textContent.trim());
        }
      }).observe(document.getElementById('toastContainer'), { childList: true });
    });
    await g.page.click('#cardStack .place-card:not(.card-fundo) .card-btn-reject');
    await esperarOuExplodir(g.page, () => !!AppState.pendingAction && cardDaFrente().querySelector('.card-btn-reject').disabled,
      'a janela do Desfazer travar o card novo');
    const r = await g.page.evaluate(() => {
      const b = cardDaFrente().querySelector('.card-btn-reject').getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await g.page.touchscreen.tap(r.x, r.y);
    await g.page.keyboard.press('ArrowLeft');
    await g.page.waitForTimeout(300);
    const esperas = await g.page.evaluate(() => {
      const chaves = ['toast.esperaDesfazer', 'toast.esperaLote', 'toast.esperaSessao', 'api.error.noSession'].map((k) => t(k));
      return window.__toastsDoSmoke.filter((s) => chaves.includes(s));
    });
    checa(esperas.length === 0, `${id}: a janela do Desfazer ganhou um aviso por cima do banner`, JSON.stringify(esperas));
    await g.fechar();
  }
  {
    // R7-3-07 (auditoria de 2026-10-02): as ações da FOTO ampliada (o "Aprovar",
    // a pílula do nome) travam pela MESMA função do ✕ ↑ ✓ do card, e o toque
    // nelas — botão `disabled`, que não recebe `click` — não dizia nada. O mesmo
    // par pointerdown/up do C14, agora na camada, com o DEDO de verdade
    // (`touchscreen.tap` no centro medido, conferido por hit-test: gotcha #26).
    // CONTROLES: o ✕ travado do card responde na mesma trava (a medida enxerga o
    // aviso), e o toque na FOTO, que não é ação, não pede aviso.
    const id = `card/trava ${MOTOR}: as ações TRAVADAS da foto ampliada respondem (R7-3-07)`;
    let soltarLote = null, primeira = true;
    const resposta = async (nome) => {
      if (nome !== 'marcar-lido') return null;
      if (primeira) { primeira = false; await new Promise((ok) => { soltarLote = ok; }); }
      return { success: false, error: 'x', errorCategory: 'unknown' };
    };
    // Pedidos de FOTO NOVA (o "Aprovar" é da foto do pedido), com o local aprovado e nome (a pílula).
    const fotoNova = (i) => cardPedido('fl' + i, { purType: 'NEW_PHOTO', reqType: 'IMAGE', updateTypeKey: 'IMAGE',
      flagType: null, flagSubjectType: null, flagEntityID: null, flagComment: '', localAprovado: true, name: 'Padaria ' + i,
      imageUrls: [`https://venue-image.waze.com/thumbs/thumb700_fl${i}.jpg`], approvedImageIds: [] });
    const g = await cardPagina([fotoNova(0), fotoNova(1), fotoNova(2)], { hasTouch: true, resposta });
    await g.page.evaluate(() => {
      window.__toastsDoSmoke = [];
      new MutationObserver((ms) => {
        for (const m of ms) for (const n of m.addedNodes) {
          if (n.classList && n.classList.contains('toast')) window.__toastsDoSmoke.push(n.textContent.trim());
        }
      }).observe(document.getElementById('toastContainer'), { childList: true });
    });
    const texto = await g.page.evaluate(() => t('toast.esperaLote'));
    const avisos = () => g.page.evaluate((x) => window.__toastsDoSmoke.filter((s) => s === x).length, texto);
    const centroDe = (sel) => g.page.evaluate((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, sel);
    const dedoChega = (p, sel) => g.page.evaluate(({ p, sel }) => {
      const e = document.elementFromPoint(p.x, p.y);
      return !!(e && e.closest(sel));
    }, { p, sel });
    const semToast = (o) => esperarOuExplodir(g.page, () => !document.querySelector('#toastContainer .toast'), o, 8000);
    await g.page.evaluate(() => { openBatchReadConfirm(); handleBatchMarkRead(); });
    await esperarOuExplodir(g.page, () => acoesTravadas() && !!cardDaFrente()
      && cardDaFrente().querySelector('.card-btn-reject').disabled, 'o lote travar o card');
    // O "Marcando…" fica enquanto o lote está no ar (R14-8-10): o toque o dispensa.
    await g.page.click('#toastContainer .toast');
    await semToast('o toast do lote sair');
    // CONTROLE: o ✕ travado do card responde na mesma trava.
    const x = await centroDe('#cardStack .place-card:not(.card-fundo) .card-btn-reject');
    await g.page.touchscreen.tap(x.x, x.y);
    await g.page.waitForTimeout(300);
    checa(await avisos() === 1, `${id}: CONTROLE — o toque no ✕ travado do card não respondeu (a medida não enxerga o aviso)`,
      `${await avisos()} avisos`);
    await g.page.waitForTimeout(3200);           // o intervalo do aviso (3 s)
    await semToast('o aviso do card sair');
    // A foto ampliada, aberta DURANTE o lote (o toque na foto do card).
    const fc = await centroDe('#cardStack .place-card:not(.card-fundo) .card-image');
    await g.page.touchscreen.tap(fc.x, fc.y);
    await esperarOuExplodir(g.page, () => Lightbox.isOpen() && document.getElementById('lightboxImage').naturalWidth > 0
      && !document.getElementById('lightboxApprove').classList.contains('hidden')
      && !document.getElementById('lightboxNome').classList.contains('hidden'), 'a foto ampliada abrir com o "Aprovar" e a pílula');
    // CONTROLE: o toque na FOTO, que não é ação, não pede aviso.
    const fl = await centroDe('#lightboxImage');
    await g.page.touchscreen.tap(fl.x, fl.y);
    await g.page.waitForTimeout(400);
    checa(await avisos() === 1, `${id}: CONTROLE — o toque na foto (não é ação) pediu o aviso da trava`, `${await avisos()} avisos`);
    for (const [n, sel] of [[2, '#lightboxApprove'], [3, '#lightboxNomeBtn']]) {
      const a = await centroDe(sel);
      const travado = await g.page.evaluate((s) => document.querySelector(s).disabled, sel);
      checa(travado && await dedoChega(a, sel), `${id}: PRÉ-CONDIÇÃO — ${sel} não está travado, ou o dedo não chega nele`);
      await g.page.touchscreen.tap(a.x, a.y);
      await g.page.waitForTimeout(400);
      checa(await avisos() === n, `${id}: DEFEITO — o toque em ${sel} travado da foto ampliada não respondeu`, `${await avisos()} avisos`);
      await g.page.waitForTimeout(3200);
      await semToast('o aviso da foto sair');
    }
    if (soltarLote) soltarLote();
    await esperarNaPagina(g.page, () => !acoesTravadas(), 8000);
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }
  {
    // R8-3-03 (auditoria de 2026-10-03): o ✓ "Salvar nome" da edição trava pela
    // MESMA trava (a conferência de um 401, a sessão renovando), e o toque nele
    // ficava calado — enquanto o Enter no campo, na mesma trava, dizia "Espere a
    // conferência…". O DEDO de verdade no centro medido, conferido por hit-test
    // (gotcha #26). CONTROLES: sem trava, o ✓ desabilitado pelo nome VAZIO segue
    // calado; e o Enter no campo, na mesma trava, avisa (a medida enxerga o aviso).
    const id = `card/trava ${MOTOR}: o ✓ "Salvar nome" TRAVADO responde (R8-3-03)`;
    const fotoNova = (i) => cardPedido('fo' + i, { purType: 'NEW_PHOTO', reqType: 'IMAGE', updateTypeKey: 'IMAGE',
      flagType: null, flagSubjectType: null, flagEntityID: null, flagComment: '', localAprovado: true, name: 'Padaria ' + i,
      imageUrls: [`https://venue-image.waze.com/thumbs/thumb700_fo${i}.jpg`], approvedImageIds: [] });
    const g = await cardPagina([fotoNova(0), fotoNova(1)], { hasTouch: true });
    await g.page.evaluate(() => {
      window.__toastsDoSmoke = [];
      new MutationObserver((ms) => {
        for (const m of ms) for (const n of m.addedNodes) {
          if (n.classList && n.classList.contains('toast')) window.__toastsDoSmoke.push(n.textContent.trim());
        }
      }).observe(document.getElementById('toastContainer'), { childList: true });
    });
    const texto = await g.page.evaluate(() => t('toast.esperaSessao'));
    const avisos = () => g.page.evaluate((x) => window.__toastsDoSmoke.filter((s) => s === x).length, texto);
    const centroDe = (sel) => g.page.evaluate((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, sel);
    const dedoChega = (p, sel) => g.page.evaluate(({ p, sel }) => {
      const e = document.elementFromPoint(p.x, p.y);
      return !!(e && e.closest(sel));
    }, { p, sel });
    const escrever = (v) => g.page.evaluate((valor) => {
      const i = document.getElementById('lightboxNomeInput');
      i.value = valor; i.dispatchEvent(new Event('input'));
    }, v);
    const semToast = (o) => esperarOuExplodir(g.page, () => !document.querySelector('#toastContainer .toast'), o, 8000);
    // A foto ampliada e a edição do nome, pelo toque.
    const fc = await centroDe('#cardStack .place-card:not(.card-fundo) .card-image');
    await g.page.touchscreen.tap(fc.x, fc.y);
    await esperarOuExplodir(g.page, () => Lightbox.isOpen() && document.getElementById('lightboxImage').naturalWidth > 0
      && !document.getElementById('lightboxNome').classList.contains('hidden'), 'a foto ampliada abrir com a pílula do nome');
    const pc = await centroDe('#lightboxNomeBtn');
    await g.page.touchscreen.tap(pc.x, pc.y);
    await esperarOuExplodir(g.page, () => editandoNome(), 'a edição do nome abrir');
    // CONTROLE: sem trava, o ✓ desabilitado pelo nome VAZIO não pede aviso nenhum.
    await escrever('');
    const ok0 = await centroDe('#lightboxNomeOk');
    const vazio = await g.page.evaluate(() => document.getElementById('lightboxNomeOk').disabled && !acoesTravadas());
    checa(vazio && await dedoChega(ok0, '#lightboxNomeOk'), `${id}: PRÉ-CONDIÇÃO — o ✓ do nome vazio não está desabilitado sem trava, ou o dedo não chega nele`);
    await g.page.touchscreen.tap(ok0.x, ok0.y);
    await g.page.waitForTimeout(400);
    checa(await avisos() === 0, `${id}: CONTROLE — sem trava, o toque no ✓ do nome vazio pediu o aviso da trava`, `${await avisos()} avisos`);
    // A trava (a conferência de um 401) com um nome novo no campo.
    await escrever('Padaria Certa');
    await g.page.evaluate(() => { escritasConferindo++; aplicarTravaDeAcao(); });
    await doisQuadros(g.page);
    const ok1 = await centroDe('#lightboxNomeOk');
    const travado = await g.page.evaluate(() => document.getElementById('lightboxNomeOk').disabled && acoesTravadas());
    checa(travado && await dedoChega(ok1, '#lightboxNomeOk'), `${id}: PRÉ-CONDIÇÃO — a trava não desabilitou o ✓, ou o dedo não chega nele`);
    await g.page.touchscreen.tap(ok1.x, ok1.y);
    await g.page.waitForTimeout(400);
    checa(await avisos() === 1, `${id}: DEFEITO — o toque no ✓ "Salvar nome" travado não disse nada`, `${await avisos()} avisos`);
    await g.page.waitForTimeout(3200);             // o intervalo do aviso (3 s)
    await semToast('o aviso do ✓ sair');
    // CONTROLE: o Enter no campo, na MESMA trava, avisa (o par que o toque passa
    // a seguir). Contado a partir de agora: independe de o toque ter avisado.
    const antesDoEnter = await avisos();
    await g.page.focus('#lightboxNomeInput');
    await g.page.keyboard.press('Enter');
    await g.page.waitForTimeout(400);
    checa(await avisos() === antesDoEnter + 1, `${id}: CONTROLE — o Enter no campo, na mesma trava, não avisou (a medida estaria cega)`,
      `${await avisos() - antesDoEnter} aviso(s) do Enter`);
    const segue = await g.page.evaluate(() => ({ aberta: Lightbox.isOpen(), editando: editandoNome(),
      campo: document.getElementById('lightboxNomeInput').value }));
    checa(segue.aberta && segue.editando && segue.campo === 'Padaria Certa', `${id}: o toque ou o Enter na trava perdeu a edição`, JSON.stringify(segue));
    await g.page.evaluate(() => { escritasConferindo--; aplicarTravaDeAcao(); });
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }
}

// ── MAPA E PÍLULA: nada sai da caixa (auditoria de 2026-09-26) ─────────────
//
//  C5 · girar o aparelho (a caixa do mini-mapa ENCOLHE) deixava marcador fora
//       dela — o observer só refazia quando a caixa crescia.
//  C11 · um ponto longe derrubava do mini-mapa os que cabiam, e o aviso falava
//       do ponto errado ("a posição proposta está a 5 m — fora deste mapa").
//  C4 · o mapa ampliado de um pedido de 82 km abria no vazio entre os dois.
//  C12 · no lightbox, a pílula do nome em edição estourava a tela com nome longo.
{
  const perto = (ll, m) => [ll[0] + m / 111320, ll[1]];
  const marcasDentro = (page) => page.evaluate(() => {
    const box = cardDaFrente().querySelector('.card-map');
    const b = box.getBoundingClientRect();
    const marcas = [...box.querySelectorAll('.card-map-marks .mapa-marca')].map((m) => m.getBoundingClientRect());
    return { caixa: `${Math.round(b.width)}x${Math.round(b.height)}`, desenhadoPara: `${box.dataset.mapaW}x${box.dataset.mapaH}`,
      n: marcas.length, fora: marcas.filter((m) => { const x = m.left + m.width / 2, y = m.top + m.height / 2;
        return x < b.left + 2 || x > b.right - 2 || y < b.top + 2 || y > b.bottom - 2; }).length };
  });
  {
    const id = 'mapa/C5: girar o aparelho';
    const g = await gestosPagina({ viewport: { width: 412, height: 915 } },
      [gestosDaFixture(0, 'gA', { imageUrls: [] }), gestosPedidoDeFoto('gB')]);
    const antes = await marcasDentro(g.page);
    for (const vp of [{ width: 915, height: 412 }, { width: 280, height: 653 }]) {
      await g.page.setViewportSize(vp);
      await doisQuadros(g.page); await doisQuadros(g.page);
      await g.page.waitForTimeout(150);
      const m = await marcasDentro(g.page);
      checa(m.caixa !== antes.caixa, `${id}: PRÉ-CONDIÇÃO — a caixa do mapa não mudou de tamanho em ${vp.width}x${vp.height}`, JSON.stringify(m));
      checa(m.n > 0 && m.fora === 0, `${id}: marcador FORA da caixa em ${vp.width}x${vp.height}`, JSON.stringify(m));
      checa(m.desenhadoPara === m.caixa, `${id}: o mapa ficou desenhado pra outra caixa em ${vp.width}x${vp.height}`, JSON.stringify(m));
    }
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }
  const f19 = FIXTURES_PAISES[19];
  const centro = f19.mapa.centro;
  {
    const id = 'mapa/C11: proposta a 5 m e entrada a 30 km';
    const g = await gestosPagina({ viewport: { width: 393, height: 852 } }, [gestosDaFixture(19, 'fA', { imageUrls: [],
      mapa: { centro, proposto: perto(centro, 5), movidoM: 5, entradas: [{ ll: perto(centro, 30000), estado: 'nova', nome: 'Portão', distM: 30000 }] } })]);
    const r = await g.page.evaluate(() => {
      const box = cardDaFrente().querySelector('.card-map');
      return { marcas: [...box.querySelectorAll('.card-map-marks .mapa-marca')].map((e) => e.className.replace('mapa-marca ', '')),
        aviso: (box.querySelector('.mapa-fora') || {}).textContent || null };
    });
    checa(r.marcas.join() === 'mapa-atual,mapa-proposto', `${id}: a proposta a 5 m sumiu do mapa por causa da entrada longe`, JSON.stringify(r));
    checa(/entrada/.test(r.aviso || '') && /30/.test(r.aviso || ''), `${id}: o aviso não fala da ENTRADA que ficou fora`, r.aviso);
    await g.fechar();
  }
  {
    const id = 'mapa/C4: mapa ampliado de um pedido de 82 km';
    const g = await gestosPagina({ viewport: { width: 393, height: 852 } }, [gestosDaFixture(19, 'fL', { imageUrls: [],
      mapa: { centro, proposto: perto(centro, 82000), movidoM: 82000, entradas: [] } })]);
    await g.page.locator('#cardStack .place-card:not(.card-fundo) .card-map').click();
    await g.page.waitForTimeout(600);
    const naTela = () => g.page.evaluate(() => [...document.querySelectorAll('#mapaLbMarks .mapa-marca')].map((e) => {
      const r = e.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
    }));
    const abriu = await naTela();
    checa(abriu.length === 2 && abriu.every(Boolean), `${id}: o ampliado abriu sem os dois pontos na tela`, JSON.stringify(abriu));
    await g.page.locator('#mapaLbCentrar').click();
    await g.page.waitForTimeout(400);
    const voltou = await naTela();
    checa(voltou.length === 2 && voltou.every(Boolean), `${id}: o "Voltar ao pedido" voltou pro vazio`, JSON.stringify(voltou));
    // CONTROLE do L16 (abaixo): com os dois pontos na tela, nenhum aviso de
    // "fora do mapa" e a legenda com os dois.
    const ctl = await g.page.evaluate(() => ({ aviso: !!document.querySelector('#mapaLbMarks .mapa-fora'),
      legenda: document.querySelectorAll('#mapaLbLegenda .mapa-leg').length }));
    checa(!ctl.aviso && ctl.legenda === 2, `${id}: com os dois pontos na tela, apareceu aviso ou a legenda perdeu um`, JSON.stringify(ctl));
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }
  {
    // L16: um movimento de 2.510 km não cabe nem no z4 (o mais aberto). O card
    // avisava ("a posição proposta está a 2.510 km — fora deste mapa"); o
    // ampliado abria calado, com "Depois" na legenda de um marcador fora da tela.
    const id = 'mapa/L16: mapa ampliado de um movimento de 2.510 km';
    const longe = [centro[0], centro[1] + 24.6];
    const g = await gestosPagina({ viewport: { width: 393, height: 852 } }, [gestosDaFixture(19, 'fZ', { imageUrls: [],
      mapa: { centro, proposto: longe, movidoM: 2510000, entradas: [] } })]);
    const card = await g.page.evaluate(() => (cardDaFrente().querySelector('.mapa-fora') || {}).textContent || null);
    checa(!!card, `${id}: PRÉ-CONDIÇÃO — o card não avisou (o ponto devia não caber)`);
    await g.page.locator('#cardStack .place-card:not(.card-fundo) .card-map').click();
    await g.page.waitForTimeout(600);
    const r = await g.page.evaluate(() => {
      const av = document.querySelector('#mapaLbMarks .mapa-fora');
      const ra = av && av.getBoundingClientRect();
      const marcas = [...document.querySelectorAll('#mapaLbMarks .mapa-marca')].map((e) => {
        const b = e.getBoundingClientRect();
        return { cls: e.className.replace('mapa-marca ', ''), naTela: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight };
      });
      // O aviso NÃO pode virar alvo: arrastar o mapa por cima dele tem que andar.
      const noAviso = ra ? document.elementFromPoint(ra.left + ra.width / 2, ra.top + ra.height / 2) : null;
      return { aviso: av ? av.textContent : null, marcas,
        legenda: [...document.querySelectorAll('#mapaLbLegenda .mapa-leg')].map((e) => e.textContent.trim()),
        avisoRoubaODedo: !!(noAviso && noAviso.closest && noAviso.closest('.mapa-fora')) };
    });
    const fora = r.marcas.filter((m) => !m.naTela).map((m) => m.cls);
    checa(fora.length === 1, `${id}: PRÉ-CONDIÇÃO — esperava UM marcador fora da tela`, JSON.stringify(r.marcas));
    checa(r.aviso === card, `${id}: o ampliado não disse o que ficou fora (ou disse outra coisa que o card)`, `${r.aviso} vs ${card}`);
    checa(r.legenda.length === 1, `${id}: a legenda prometeu o marcador que está fora da tela`, JSON.stringify(r.legenda));
    checa(!r.avisoRoubaODedo, `${id}: o aviso recebe o dedo — arrastar o mapa por cima dele não anda`);
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }
  {
    const id = 'mapa/C12: pílula do nome em edição no Fold, em francês';
    const longo = gestosPedidoDeFoto('uN', ['foto-a']);
    longo.name = 'Aeroport Josep Tarradellas Barcelona - El Prat Terminal T1';
    const g = await gestosPagina({ viewport: { width: 280, height: 653 }, hasTouch: true, isMobile: true }, [longo], { lang: 'fr' });
    await g.page.evaluate(() => { const p = AppState.currentPlace; openLightbox(p.imageUrls, 0, -1, p.name, false, p); });
    await g.page.waitForTimeout(400);
    await g.page.evaluate(() => abrirEdicaoNome());
    await g.page.waitForTimeout(300);
    const m = await g.page.evaluate(() => {
      const b = document.getElementById('lightboxNomeBtn').getBoundingClientRect();
      const t = document.getElementById('lightboxNomeTxt');
      // "Longo o bastante" é o texto INTEIRO não caber na tela — não "está
      // cortado", que é justamente o que o conserto faz (sem ele a pílula cresce).
      return { esq: Math.round(b.left), dir: Math.round(b.right), tela: innerWidth, largura: t.scrollWidth,
        editando: document.getElementById('lightboxNome').classList.contains('editando') };
    });
    checa(m.editando && m.largura > m.tela - 24, `${id}: PRÉ-CONDIÇÃO — não entrou em edição ou o nome não é longo o bastante pra medir`, JSON.stringify(m));
    checa(m.esq >= 0 && m.dir <= m.tela, `${id}: a pílula do nome estourou a tela`, JSON.stringify(m));
    checa(g.erros.length === 0, `${id}: erro de JS`, g.erros[0]);
    await g.fechar();
  }
}

// ── DUAS ABAS: o "Sair", o placar e as preferências (auditoria de 2026-09-29) ─
//
// O app aberto em duas abas do MESMO navegador, que dividem o armazenamento.
// Cada aba guarda na memória a sessão, o placar e as preferências, e grava
// tudo INTEIRO a cada gesto; o "Sair" numa não chegava à outra, e a ação comum
// de uma desfazia o placar e as escolhas da outra (R4-5 A1 e A2, R4-2 O7). O
// teste de unidade (`test/contas-abas.test.mjs`) entrega o aviso do navegador
// À MÃO; aqui ele é o de verdade, entre duas páginas, pelos caminhos da tela.
//
// CONTROLE: o mesmo percurso com o ouvinte do aviso TIRADO de uma das abas tem
// de reprovar como o app de antes reprovava — prova de que as medidas enxergam
// o defeito, e não passam por acaso de ordem de evento.
{
  const PERFIL_ABAS = { id: 4242, userName: 'editor_abas', rank: 5, isAreaManager: true, isStaff: false,
    editableCountryIDs: [30], areas: [], managedAreas: [] };
  // OUTRA conta, que entra pela aba A na seção 4 (o login por cookies de
  // mentira responde com ela quando o cookie diz `conta-5151`).
  const PERFIL_OUTRA = { ...PERFIL_ABAS, id: 5151, userName: 'outra_conta' };
  // Pedidos DISTINTOS (gotcha 3.5): a fila real nunca tem dois cards do mesmo pedido.
  const FILA_ABAS = Array.from({ length: 3 }, (_, i) => Object.values(CARDS).map((p, k) => ({ ...p,
    venueID: `va${i}-${k}`, updateRequestID: `ua${i}-${k}` }))).flat();
  const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  // `fila`: a busca das duas abas (a seção 2c monta a dela); `guardado`: chaves a
  // mais no aparelho antes da abertura (a lista de autores da recusa automática).
  const abrirAbas = async ({ semSessao = false, fila = FILA_ABAS, guardado = null } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block', locale: 'pt-BR' });
    const rede = [];
    // Sessões que MORRERAM no servidor: respondem o 401 carimbado do core. A
    // presença fica de fora — a sentinela deste arquivo reprova 401 de sessão
    // nela, e ela não é o que se mede aqui.
    const mortos = new Set();
    // A seção 5 SEGURA a resposta de um pedido (a 1ª decisão dele) até soltar.
    const segurar = new Map();
    // A seção 6 abre um link de pareamento VENCIDO: o resgate é recusado, depois
    // de esperar o que o teste segurar (`resgate.segurar`, uma promessa).
    const resgate = { segurar: null };
    let logins = 0;
    await ctx.route('**/*.waze.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
    await ctx.route('**/api/**', async (r) => {
      const rota = new URL(r.request().url()).pathname.replace(/^\/api\//, '');
      let corpo = {};
      try { corpo = JSON.parse(r.request().postData() || '{}'); } catch (e) { corpo = {}; }
      rede.push({ rota, token: corpo.sessionToken || null, acao: corpo.action || null, pedido: corpo.venueID || null });
      if (rota === 'validar-place' && segurar.has(corpo.venueID)) {
        const espera = segurar.get(corpo.venueID);
        segurar.delete(corpo.venueID);
        await espera;
      }
      if (rota === 'parear' && corpo.action === 'claim') {
        if (resgate.segurar) await resgate.segurar;
        return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false,
          error: 'Código inválido ou expirado. Gere um novo no aparelho logado.', errorKey: 'srv.err.pairCodeInvalid' }) });
      }
      const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (mortos.has(corpo.sessionToken) && !/^(presenca-app|chat)$/.test(rota)) {
        return r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ success: false,
          error: 'Sessão expirada ou inválida', errorKey: 'srv.err.sessionExpired', errorCategory: 'unauthorized' }) });
      }
      // O login por cookies: uma sessão NOVA a cada entrada, da conta que o cookie diz.
      if (rota === 'testar-cookies') {
        const outra = String(corpo.cookies || '').includes('conta-5151');
        return json({ success: true, sessionToken: outra ? 'tok-outra' : `tok-abas-${++logins}`, conta: outra ? '5151' : '4242' });
      }
      if (rota === 'perfil') return json({ success: true, profile: corpo.sessionToken === 'tok-outra' ? PERFIL_OUTRA : PERFIL_ABAS,
        visivelNoWme: true });
      if (rota === 'buscar-places') return json({ success: true, places: fila, hasMore: false, page: 1,
        total: fila.length, totalAll: fila.length, blocked: 0 });
      if (rota === 'lista-paises') return json({ success: true, countries: [{ id: 30, name: 'Brazil', abbr: 'BR' }] });
      if (rota === 'lista-estados') return json({ success: true, states: [] });
      if (rota === 'presenca-app') return json({ success: true, online: [], conversas: [] });
      return json({ success: true });
    });
    const erros = [];
    // `antesDeAbrir`: um script (ou uma lista deles) que roda na aba antes do app
    // (a extensão de mentira da seção 6). `caminho`: o que vem depois da raiz (o
    // link de pareamento da seção 6).
    const abrir = async (antesDeAbrir, caminho = '') => {
      const p = await ctx.newPage();
      p.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 120)));
      for (const script of [].concat(antesDeAbrir || [])) await p.addInitScript(script);
      await p.goto(BASE + caminho, { waitUntil: 'domcontentloaded' });
      return p;
    };
    // A seção 6 abre as abas ela mesma, SEM sessão nenhuma no aparelho.
    if (semSessao) return { ctx, rede, erros, abrir, resgate };
    // A sessão salva e um placar com a cota do Desfazer cumprida (L6: 10): as
    // ações saem sem a janela, e o percurso não espera 3 s por ✕.
    const A = await abrir();
    await A.evaluate((mais) => {
      localStorage.setItem('waze_session_token', 'tok-abas');
      localStorage.setItem('waze_places_stats', JSON.stringify({ read: 0, rejected: 20, skipped: 0 }));
      localStorage.setItem('waze_places_preferences', JSON.stringify({ undoEnabled: false, presenca: true,
        undoGateSeen: true, dicaDesfazerVista: true, comoFuncionaVisto: true, consequenciaVista: { reject: true, read: true } }));
      for (const [k, v] of Object.entries(mais || {})) localStorage.setItem(k, v);
    }, guardado);
    await A.reload({ waitUntil: 'domcontentloaded' });
    const B = await abrir();
    const pronta = () => AppState.authenticated && !!AppState.profile && !!AppState.currentPlace
      && !!document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-reject');
    await esperarOuExplodir(A, pronta, 'a aba A abrir com a sessão e a fila');
    await esperarOuExplodir(B, pronta, 'a aba B abrir com a sessão e a fila');
    return { ctx, A, B, rede, erros, mortos, segurar };
  };
  // Um ✕ pelo botão do card da frente, esperando o card TROCAR e o envio voltar.
  const rejeitarNa = (page) => page.evaluate(async () => {
    const atual = () => AppState.currentPlace && AppState.currentPlace.updateRequestID;
    const antes = atual();
    document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-reject').click();
    const lim = performance.now() + 10000;
    while ((atual() === antes || AppState.inFlightActions > 0 || AppState.pendingAction) && performance.now() < lim) {
      await new Promise((ok) => setTimeout(ok, 16));
    }
  });
  const rejeitadosGravados = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('waze_places_stats') || '{}').rejected);
  // Um interruptor da aba Preferências, pelo clique (é o `change` que grava).
  const tocarPreferencia = (page, id) => page.evaluate(async (idDoInterruptor) => {
    document.getElementById('filtersBtn').click();
    await new Promise((ok) => setTimeout(ok, 150));
    document.getElementById('filtersTabPrefs').click();
    document.getElementById(idDoInterruptor).click();
    document.getElementById('closeFilters').click();
    await new Promise((ok) => setTimeout(ok, 150));
  }, id);
  const sairPelaAjuda = (page) => page.evaluate(async () => {
    document.getElementById('helpBtn').click();
    await new Promise((ok) => setTimeout(ok, 150));
    document.getElementById('logoutBtn').click();
    await new Promise((ok) => setTimeout(ok, 150));
    document.getElementById('confirmLogout').click();
  });
  const naEntrada = () => !document.getElementById('authScreen').classList.contains('hidden')
    && document.getElementById('appScreen').classList.contains('hidden');
  const aparelho = (page) => page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));

  // ── 1. com o aviso de verdade entre as duas ─────────────────────────────
  const m = await abrirAbas();
  // As duas abas abrem com a MESMA fila (a mesma busca): o que a A decide, a B
  // tem como card — o da frente na tela, os outros mais atrás.
  const filaNaB = () => m.B.evaluate(() => ({ frente: AppState.currentPlace && AppState.currentPlace.updateRequestID,
    fila: AppState.queue.map((p) => p.updateRequestID), restam: AppState.serverTotal,
    fundo: (document.querySelector('#cardStack .card-fundo') || { dataset: {} }).dataset.pedido || null }));
  const antesB = await filaNaB();
  // O placar: 3 ✕ na A e 1 na B. A B tem de VER os três antes do dela.
  const decididosNaA = [];
  for (let i = 0; i < 3; i++) {
    decididosNaA.push(await m.A.evaluate(() => AppState.currentPlace.updateRequestID));
    await rejeitarNa(m.A);
  }
  const bViu = await esperarNaPagina(m.B, () => AppState.stats.rejected === 23, 5000);
  checa(bViu.ok, 'duas abas: a aba B não viu no placar os 3 ✕ da aba A');
  // R10-2-02 — vale a PRIMEIRA decisão. O que a A decidiu sai da fila da B, com
  // o "Restam" e o card de fundo; o da frente (o mesmo nas duas) FICA na tela, e
  // o ✕ nele não sai pro Waze nem conta de novo: diz que foi decidido na outra.
  checa(decididosNaA[0] === antesB.frente && decididosNaA.every((u) => antesB.fila.includes(u)),
    'duas abas: PRÉ-CONDIÇÃO — a A não decidiu o card da frente da B e mais dois da fila dela (as abas não tinham a mesma fila)',
    JSON.stringify({ decididosNaA, frente: antesB.frente }));
  await m.B.evaluate((d) => { window.__decididosNaA = d; }, decididosNaA);
  const saiuDaB = await esperarNaPagina(m.B, () => !AppState.queue.some((p) => window.__decididosNaA.slice(1).includes(p.updateRequestID))
    && document.getElementById('pendingCount').textContent.trim() === String(AppState.serverTotal), 5000);
  const depoisB = await filaNaB();
  checa(saiuDaB.ok && depoisB.frente === antesB.frente && depoisB.fila.length === antesB.fila.length - 2
    && depoisB.restam === antesB.restam - 2 && depoisB.fundo && !decididosNaA.some((u) => depoisB.fundo.endsWith('|' + u)),
    'duas abas: o que a aba A decidiu seguiu na fila da B (ou o "Restam" e o card de fundo não acompanharam, ou o card da TELA trocou)',
    JSON.stringify({ antesB: { frente: antesB.frente, n: antesB.fila.length, restam: antesB.restam, fundo: antesB.fundo },
      depoisB: { frente: depoisB.frente, n: depoisB.fila.length, restam: depoisB.restam, fundo: depoisB.fundo } }));
  const redeAntesDoFantasma = m.rede.length;
  const vFrente = await m.B.evaluate(() => AppState.currentPlace.venueID);
  await rejeitarNa(m.B);
  const fantasma = await m.B.evaluate(() => ({ placar: AppState.stats.rejected, restam: AppState.serverTotal,
    frente: AppState.currentPlace && AppState.currentPlace.updateRequestID,
    aviso: [...document.querySelectorAll('#toastContainer > *')].map((e) => e.textContent).join(' | ') }));
  checa(!m.rede.slice(redeAntesDoFantasma).some((x) => x.rota === 'validar-place')
    && m.rede.filter((x) => x.rota === 'validar-place' && x.pedido === vFrente).length === 1,
    'duas abas: o ✕ da aba B no card que a A já decidiu saiu pro Waze (a segunda decisão do mesmo pedido)',
    JSON.stringify(m.rede.slice(redeAntesDoFantasma)));
  checa(fantasma.placar === 23 && fantasma.restam === depoisB.restam - 1 && fantasma.frente !== antesB.frente,
    'duas abas: o ✕ da aba B no card que a A já decidiu contou de novo no placar (ou o card não saiu, ou o "Restam" não desceu)',
    JSON.stringify(fantasma));
  checa(/já foi decidido em outra aba/.test(fantasma.aviso),
    'duas abas: o ✕ descontado na aba B não disse que o pedido foi decidido na outra aba', fantasma.aviso.slice(0, 160));
  // E o ✕ seguinte da B, num pedido que a A NÃO decidiu, conta como sempre.
  await rejeitarNa(m.B);
  const aViu = await esperarNaPagina(m.A, () => AppState.stats.rejected === 24, 5000);
  const gravado = await rejeitadosGravados(m.A);
  const telas = await Promise.all([m.A, m.B].map((p) => p.evaluate(() => document.getElementById('rejectedCount').textContent.trim())));
  checa(gravado === 24, 'duas abas: o placar gravado perdeu os ✕ da outra aba (3 na A e 1 na B)', `gravado ${gravado}`);
  checa(aViu.ok && telas[0] === '24' && telas[1] === '24', 'duas abas: o placar NA TELA não diz os 4 ✕ nas duas', JSON.stringify(telas));
  // CONTROLE do percurso: o Histórico (que já relia) contou os quatro.
  const hist = await m.A.evaluate(() => (JSON.parse(localStorage.getItem('waze_places_history') || '{}')._total || {}).rejected);
  checa(hist === 4, 'duas abas: CONTROLE — o Histórico não contou os 4 ✕ (o percurso não fez o que diz)', String(hist));

  // As preferências: a pessoa liga "Pular guarda o pedido" e desliga "Ver quem
  // está no app" na A; a B grava as preferências dela (o interruptor do
  // Desfazer, duas vezes) — e as escolhas da A têm de sobreviver.
  await tocarPreferencia(m.A, 'prefPularGuarda');
  await tocarPreferencia(m.A, 'prefPresenca');
  const bRelu = await esperarNaPagina(m.B, () => AppState.preferences.pularGuarda === true
    && AppState.preferences.presenca === false, 5000);
  checa(bRelu.ok, 'duas abas: a aba B não releu as preferências escolhidas na A');
  const selo = await m.B.evaluate(() => (cardDaFrente()?.querySelector('.swipe-stamp-up span')?.textContent || '').trim());
  checa(selo.includes('⭐'), 'duas abas: o selo do ↑ da aba B não diz que guarda (o que ela FAZ e o que DIZ divergem)', selo);
  // Um ESPIÃO de escrita na B, pro "Sair" lá embaixo: gravar o MESMO valor que
  // a A acabou de gravar (o placar e as preferências de fábrica) não muda o
  // aparelho, e a foto dele antes e depois não veria — sabotado com a B
  // regravando o de fábrica, só o espião reprovou. O CONTROLE dele é aqui: a B
  // grava as preferências pelo interruptor, e ele tem de ver.
  await m.B.evaluate(() => {
    window.__escritasDaB = [];
    for (const nome of ['setItem', 'removeItem', 'clear']) {
      const original = Storage.prototype[nome];
      Storage.prototype[nome] = function (...args) {
        if (this === localStorage) window.__escritasDaB.push(nome + ':' + (args[0] === undefined ? '' : args[0]));
        return original.apply(this, args);
      };
    }
  });
  await tocarPreferencia(m.B, 'prefUndoEnabled');
  await tocarPreferencia(m.B, 'prefUndoEnabled');
  const espiouB = await m.B.evaluate(() => window.__escritasDaB.slice());
  checa(espiouB.includes('setItem:waze_places_preferences'),
    'duas abas: CONTROLE — o espião de escrita da aba B não viu a B gravar as preferências (ele estaria cego no "Sair")', JSON.stringify(espiouB));
  const prefs = await m.A.evaluate(() => JSON.parse(localStorage.getItem('waze_places_preferences') || '{}'));
  checa(prefs.pularGuarda === true, 'duas abas: uma escrita da aba B desfez o "Pular guarda o pedido" ligado na A');
  checa(prefs.presenca === false, 'duas abas: uma escrita da aba B religou o "Ver quem está no app" (a pessoa volta ao mapa do WME)');
  const antesDoPular = m.rede.length;
  await m.B.evaluate(async () => {
    const antes = AppState.currentPlace && AppState.currentPlace.updateRequestID;
    document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-skip').click();
    const lim = performance.now() + 10000;
    while ((AppState.currentPlace && AppState.currentPlace.updateRequestID) === antes && performance.now() < lim) {
      await new Promise((ok) => setTimeout(ok, 16));
    }
  });
  const estrela = await esperarNaPagina(m.B, () => AppState.inFlightActions === 0, 5000);
  checa(estrela.ok && m.rede.slice(antesDoPular).some((x) => x.rota === 'guardar-pedido'),
    'duas abas: o ↑ da aba B não guardou o pedido — ela seguiu com a preferência de antes');

  // CONTROLE da QUEDA: a sessão cai na A (sem "Sair"). O token sai, a conta
  // fica — e a B segue na fila, com os dados (a mesma pessoa volta).
  await m.A.evaluate(() => derrubarSessao('srv.err.sessionExpired'));
  await esperarNaPagina(m.A, () => !localStorage.getItem('waze_session_token'), 3000);
  await dormir(600);
  const bDepoisDaQueda = await m.B.evaluate(() => ({ auth: AppState.authenticated,
    card: !!document.querySelector('#cardStack .place-card:not(.card-fundo)') }));
  checa(bDepoisDaQueda.auth && bDepoisDaQueda.card, 'duas abas: a QUEDA da sessão na aba A encerrou a B como se fosse o "Sair"',
    JSON.stringify(bDepoisDaQueda));
  // A entra de novo, e a B fica com algo aberto por cima (os Filtros).
  await m.A.evaluate(() => localStorage.setItem('waze_session_token', 'tok-abas-2'));
  await m.A.reload({ waitUntil: 'domcontentloaded' });
  await esperarOuExplodir(m.A, () => AppState.authenticated && !!AppState.profile, 'a aba A entrar de novo');
  await m.B.evaluate(() => document.getElementById('filtersBtn').click());
  await esperarOuExplodir(m.B, () => !document.getElementById('filtersModal').classList.contains('hidden'), 'os Filtros abrirem na aba B');

  // O "Sair" na A, pela Ajuda (o espião da B começa vazio: ver acima).
  await m.B.evaluate(() => { window.__escritasDaB.length = 0; });
  await sairPelaAjuda(m.A);
  await esperarOuExplodir(m.A, naEntrada, 'a aba A voltar à entrada');
  const noSair = await aparelho(m.A);
  const redeNoSair = m.rede.length;
  const bSaiu = await esperarNaPagina(m.B, naEntrada, 5000);
  checa(bSaiu.ok, 'duas abas: o "Sair" na aba A não chegou à B — ela seguiu logada, com a fila na tela');
  const b = await m.B.evaluate(() => ({
    auth: AppState.authenticated, perfil: !!AppState.profile, memoria: API.temSessaoNaMemoria(),
    card: !!document.querySelector('#cardStack .place-card'),
    filtros: !document.getElementById('filtersModal').classList.contains('hidden'),
    aviso: [...document.querySelectorAll('#toastContainer > *')].map((e) => e.textContent).join(' | '),
  }));
  checa(!b.auth && !b.perfil && !b.memoria && !b.card, 'duas abas: a aba B ficou com a sessão, o perfil ou o card de quem saiu', JSON.stringify(b));
  checa(!b.filtros, 'duas abas: os Filtros ficaram abertos por cima da entrada na aba B');
  checa(/outra aba/.test(b.aviso), 'duas abas: a aba B foi pra entrada sem dizer por quê', b.aviso.slice(0, 120));
  await dormir(500);
  const depois = await aparelho(m.A);
  checa(depois === noSair, 'duas abas: a aba B GRAVOU no aparelho depois do "Sair" da A', `${noSair.slice(0, 160)} → ${depois.slice(0, 160)}`);
  const escritasDaB = await m.B.evaluate(() => window.__escritasDaB);
  checa(Array.isArray(escritasDaB) && escritasDaB.length === 0,
    'duas abas: a aba B mexeu no aparelho ao receber o "Sair" da A (ela só solta a memória)', JSON.stringify(escritasDaB));
  checa(!m.rede.slice(redeNoSair).some((x) => /validar-place|marcar-lido|guardar-pedido/.test(x.rota)),
    'duas abas: uma decisão saiu pro Waze depois do "Sair"');
  checa(m.erros.length === 0, 'duas abas: erro de JS', m.erros[0]);
  await m.ctx.close();

  // ── 2. CONTROLE: o mesmo percurso, com a aba B SURDA ao aviso ────────────
  // É o app de antes, em miniatura: sem o ouvinte, a B grava por cima e o
  // "Sair" não chega. Se isto passar, as medidas de cima não enxergam nada.
  const c = await abrirAbas();
  await c.B.evaluate(() => window.removeEventListener('storage', aoGravarEmOutraAba));
  for (let i = 0; i < 2; i++) await rejeitarNa(c.A);
  await dormir(300);
  // O 1º ✕ da B cai no card da frente, que a A já decidiu: é descontado e não
  // grava nada (R10-2-02, seção 1). O 2º é num pedido que a A não decidiu, e é
  // ELE que grava o placar velho da B por cima.
  await rejeitarNa(c.B);
  await rejeitarNa(c.B);
  await dormir(300);
  const controle = await rejeitadosGravados(c.A);
  checa(controle === 21, 'duas abas: CONTROLE — sem o ouvinte, a aba B devia gravar por cima (21); o instrumento não vê a perda',
    String(controle));
  await sairPelaAjuda(c.A);
  await esperarOuExplodir(c.A, naEntrada, 'a aba A do controle voltar à entrada');
  await dormir(800);
  const surda = await c.B.evaluate(() => AppState.authenticated);
  checa(surda === true, 'duas abas: CONTROLE — sem o ouvinte, o "Sair" não devia chegar à B; o instrumento não vê o defeito');
  await c.ctx.close();

  // ── 2b. CONTROLE do R10-2-02: a aba B sem a retirada e sem a anotação ────
  // O app de antes, em miniatura: o que a A decide segue na fila da B, e o ✕ no
  // card que as duas tinham na frente sai pro Waze e conta de novo. Se isto
  // passar, as medidas da seção 1 não enxergam o defeito.
  const d = await abrirAbas();
  await d.B.evaluate(() => { window.tirarDaFilaOQueAOutraAbaDecidiu = () => {}; });
  const antesD = await d.B.evaluate(() => AppState.queue.length);
  for (let i = 0; i < 2; i++) await rejeitarNa(d.A);
  await esperarNaPagina(d.B, () => AppState.stats.rejected === 22, 5000);
  const filaD = await d.B.evaluate(() => AppState.queue.length);
  const vD = await d.B.evaluate(() => { decididosPorOutraAbaComCardAqui.delete(AppState.currentPlace); return AppState.currentPlace.venueID; });
  await rejeitarNa(d.B);
  await esperarNaPagina(d.B, () => AppState.inFlightActions === 0, 5000);
  const placarD = await d.B.evaluate(() => AppState.stats.rejected);
  const enviosD = d.rede.filter((x) => x.rota === 'validar-place' && x.pedido === vD).length;
  checa(filaD === antesD && enviosD === 2 && placarD === 23,
    'duas abas: CONTROLE — sem a retirada e sem a anotação (o app de antes), o ✕ da B devia sair de novo e contar; a medida não enxerga o defeito',
    JSON.stringify({ antesD, filaD, enviosD, placarD }));
  await d.ctx.close();

  // ── 2c. o que POUSA fora da fila de saída chega à outra aba (R11-2-01) ────
  // O "Marcar todos", a recusa automática e a aprovação de foto não escrevem na
  // fila de saída — o aviso da seção 1 —, e a outra aba seguia com esses pedidos
  // como card: o ✕ dela saía pro Waze, contava de novo e dizia "outro editor"
  // (MEDIDO, n01 a n03 da rodada 11). O aviso deles é o canal do POUSO
  // (`BroadcastChannel`), aqui o de verdade, entre duas páginas. Cada caminho
  // decide na A; na B, o que a A decidiu e não está na tela sai da fila (com o
  // "Restam"), e o ✕ no card da frente, que a A decidiu, não sai nem conta — e
  // diz por quê. CONTROLE: a B com o canal FECHADO (o app de antes) segue com
  // os pedidos, e o ✕ dela sai pro Waze.
  // A URL da foto proposta traz o id do PEDIDO (como no Waze): é por ele que o
  // "Aprovar" sabe que a foto na tela é a proposta (`podeAprovarAtual`).
  const FOTO_2C = 'https://venue-image.waze.com/thumbs/thumb700_uc0_abas2c.jpg';
  const pedido2c = (i, extra = {}) => ({ venueID: `vc${i}`, updateRequestID: `uc${i}`, name: `Local 2c ${i}`,
    categories: ['RESTAURANT'], address: `Rua ${i}, 10`, updateType: 'Novo Local', updateTypeKey: 'VENUE', reqType: 'VENUE',
    purType: 'NEW_PLACE', createdBy: `autor${i}`, creatorId: 8000 + i, imageUrls: [], imageUrl: null, brand: null, changes: [],
    mapa: null, dateAdded: 1785203731191 - i * 60000, lat: -23.5, lon: -46.6, ...extra });
  const estadoDaB = (page) => page.evaluate(() => ({ frente: AppState.currentPlace && AppState.currentPlace.updateRequestID,
    fila: AppState.queue.map((p) => p.updateRequestID), restam: AppState.serverTotal,
    restamNaTela: document.getElementById('pendingCount').textContent.trim(),
    anotada: !!AppState.currentPlace && decididosPorOutraAbaComCardAqui.has(AppState.currentPlace) }));
  // O ✕ da B no card da frente, que a A decidiu: não vai ao Waze, não conta, diz por quê.
  const xNoQueAOutraDecidiu = async (m, rotulo) => {
    const antes = m.rede.length;
    const rej = await m.B.evaluate(() => AppState.stats.rejected);
    await rejeitarNa(m.B);
    await esperarNaPagina(m.B, () => AppState.inFlightActions === 0, 5000);
    const r = await m.B.evaluate(() => ({ rejeitados: AppState.stats.rejected,
      aviso: [...document.querySelectorAll('#toastContainer > *')].map((e) => e.textContent).join(' | ') }));
    const saiu = m.rede.slice(antes).filter((x) => /^(validar-place|marcar-lido)$/.test(x.rota)).map((x) => x.rota);
    checa(saiu.length === 0 && r.rejeitados === rej && /já foi decidido em outra aba/.test(r.aviso),
      `duas abas (${rotulo}): o ✕ da aba B no card que a A decidiu saiu pro Waze, contou de novo ou não disse por quê`,
      JSON.stringify({ saiu, rej, ...r, aviso: r.aviso.slice(0, 160) }));
  };
  {
    // A APROVAÇÃO de foto: a A aprova a foto do card da frente (sem o Desfazer —
    // a cota está cumprida); a B, com o mesmo card na frente, fica sabendo.
    const m = await abrirAbas({ fila: [pedido2c(0, { updateType: 'Nova foto', updateTypeKey: 'IMAGE', reqType: 'IMAGE',
      purType: 'NEW_PHOTO', imageUrl: FOTO_2C, imageUrls: [FOTO_2C], newImageIdx: 0, approvedImageIds: [], localAprovado: true }),
      pedido2c(1), pedido2c(2)] });
    await m.A.evaluate(() => document.querySelector('#cardStack .place-card:not(.card-fundo) .card-image').click());
    await esperarOuExplodir(m.A, () => Lightbox.isOpen() && fotoDoLightboxNaTela() && Lightbox.podeAprovarAtual(),
      'a aba A abrir a foto com o "Aprovar"');
    await m.A.evaluate(() => document.getElementById('lightboxApprove').click());
    const pousou = await esperarNaPagina(m.A, () => !aprovandoAgora && aprovacoesNoAr.size === 0, 5000);
    checa(pousou.ok && m.rede.some((x) => x.rota === 'validar-place' && x.pedido === 'vc0'),
      'duas abas (aprovação): PRÉ-CONDIÇÃO — a aprovação da aba A não saiu');
    const soube = await esperarNaPagina(m.B, () => !!AppState.currentPlace && decididosPorOutraAbaComCardAqui.has(AppState.currentPlace), 5000);
    checa(soube.ok, 'duas abas (aprovação): a aba B não ficou sabendo da foto que a A aprovou — o ✕ dela iria pro Waze',
      JSON.stringify(await estadoDaB(m.B)));
    await xNoQueAOutraDecidiu(m, 'aprovação');
    checa(m.erros.length === 0, 'duas abas (aprovação): erro de JS', m.erros[0]);
    await m.ctx.close();
  }
  const marcarTodosNaA = async (m) => {
    await m.A.evaluate(() => openBatchReadConfirm());
    await esperarOuExplodir(m.A, () => !document.getElementById('batchReadModal').classList.contains('hidden'),
      'o "Marcar todos" abrir na aba A');
    await m.A.evaluate(() => document.getElementById('confirmBatchRead').click());
    return esperarNaPagina(m.A, () => !loteDeLidosEmVoo && AppState.inFlightActions === 0 && AppState.queue.length === 0, 8000);
  };
  {
    // O "MARCAR TODOS": a B fica só com o card da frente (anotado), "Restam 1".
    const m = await abrirAbas({ fila: [0, 1, 2, 3, 4].map((i) => pedido2c(i)) });
    const pousou = await marcarTodosNaA(m);
    checa(pousou.ok && m.rede.some((x) => x.rota === 'marcar-lido'), 'duas abas ("Marcar todos"): PRÉ-CONDIÇÃO — o lote da aba A não pousou');
    const saiu = await esperarNaPagina(m.B, () => AppState.queue.length === 1 && AppState.serverTotal === 1
      && document.getElementById('pendingCount').textContent.trim() === '1', 5000);
    const b = await estadoDaB(m.B);
    checa(saiu.ok && b.frente === 'uc0' && b.anotada,
      'duas abas ("Marcar todos"): o que a aba A marcou seguiu na fila da B (ou o "Restam" não desceu, ou o card da TELA trocou)',
      JSON.stringify(b));
    await xNoQueAOutraDecidiu(m, '"Marcar todos"');
    checa(m.erros.length === 0, 'duas abas ("Marcar todos"): erro de JS', m.erros[0]);
    await m.ctx.close();
  }
  {
    // A RECUSA AUTOMÁTICA: a A liga a recusa de um autor da lista e atualiza; o
    // que ela rejeita sai da fila da B, e o card da frente (de outro autor) fica.
    const hoje = new Date();
    const dia = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()) / 86400000;
    const spam = { creatorId: 7777, createdBy: 'spam2c' };
    const m = await abrirAbas({ fila: [pedido2c(0), pedido2c(1, spam), pedido2c(2, spam), pedido2c(3)],
      guardado: { waze_places_autores: JSON.stringify({ v: [], r: { 7777: [3, 'spam2c', dia, 0] } }) } });
    await m.A.evaluate(() => { alternarAutoDoAutor(7777); document.getElementById('refreshBtn').click(); });
    const pousou = await esperarNaPagina(m.A, () => !recusaAutomaticaRodando && !AppState.fetching && AppState.inFlightActions === 0
      && !!AppState.currentPlace && !AppState.queue.some((p) => p.creatorId === 7777), 8000);
    checa(pousou.ok && ['vc1', 'vc2'].every((v) => m.rede.some((x) => x.rota === 'validar-place' && x.pedido === v)),
      'duas abas (recusa automática): PRÉ-CONDIÇÃO — a recusa da aba A não rejeitou os dois do autor');
    const saiu = await esperarNaPagina(m.B, () => !AppState.queue.some((p) => p.creatorId === 7777) && AppState.serverTotal === 2, 5000);
    const b = await estadoDaB(m.B);
    checa(saiu.ok && b.frente === 'uc0' && !b.anotada,
      'duas abas (recusa automática): o que a recusa da aba A rejeitou seguiu na fila da B (ou o "Restam" não desceu, ou o card da TELA trocou)',
      JSON.stringify(b));
    checa(m.erros.length === 0, 'duas abas (recusa automática): erro de JS', m.erros[0]);
    await m.ctx.close();
  }
  {
    // CONTROLE: o "Marcar todos" com o canal da B FECHADO — o app de antes. A B
    // segue com os cinco, e o ✕ dela no card da frente sai pro Waze.
    const m = await abrirAbas({ fila: [0, 1, 2, 3, 4].map((i) => pedido2c(i)) });
    await m.B.evaluate(() => canalDosPousos.close());
    const pousou = await marcarTodosNaA(m);
    await dormir(600);
    const b = await estadoDaB(m.B);
    const antes = m.rede.length;
    await rejeitarNa(m.B);
    await esperarNaPagina(m.B, () => AppState.inFlightActions === 0, 5000);
    const deNovo = m.rede.slice(antes).filter((x) => x.rota === 'validar-place').length;
    checa(pousou.ok && b.fila.length === 5 && !b.anotada && deNovo === 1,
      'duas abas: CONTROLE — com o canal da aba B fechado (o app de antes), ela devia seguir com os 5 e o ✕ sair; a medida não enxerga o defeito',
      JSON.stringify({ pousou: pousou.ok, fila: b.fila.length, anotada: b.anotada, deNovo }));
    await m.ctx.close();
  }

  // ── 3. a QUEDA numa aba, com o token VELHO, não apaga o NOVO da outra ────
  // A sessão morre no servidor. A aba A percebe primeiro, derruba e ENTRA DE
  // NOVO pela extensão — a ponte, aqui de mentira, responde com um token novo
  // pelo mesmo `postMessage` da de verdade. A aba B, com o token velho na
  // memória, só descobre no ✕ seguinte: o 401 confirmado pela sonda derruba a
  // sessão DELA, e o aparelho tem de seguir com o token novo da A — que,
  // recarregada, entra com ele. Antes, a queda da B o apagava, e anotava no
  // diário de sessões uma segunda queda da mesma sessão.
  const quedaDaB = async ({ aRenova }) => {
    const q = await abrirAbas();
    q.mortos.add('tok-abas');
    if (aRenova) {
      await q.A.evaluate(() => window.addEventListener('message', (ev) => {
        const d = ev.data;
        if (d && d.source === 'wazeplaces' && d.action === 'precisa-de-sessao') {
          window.postMessage({ source: 'wazeplaces-ext', action: 'sessao', token: 'tok-abas-novo' }, location.origin);
        }
      }));
      await q.A.evaluate(() => derrubarSessao('srv.err.sessionExpired'));
      await esperarOuExplodir(q.A, () => AppState.authenticated && localStorage.getItem('waze_session_token') === 'tok-abas-novo',
        'a aba A entrar de novo pela extensão');
    }
    // A B tem de estar na fila, com o token velho, na hora do ✕: a renovação da
    // MESMA conta na A não a tira (é o controle da seção 4 visto daqui).
    const naFila = await q.B.evaluate(() => AppState.authenticated
      && !!document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-reject'));
    checa(naFila, `duas abas: a aba B não estava na fila na hora do ✕${aRenova ? ' — a renovação da MESMA conta na aba A a tirou' : ''}`);
    await q.B.evaluate(() => document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-reject')?.click());
    const caiu = await esperarNaPagina(q.B, () => !AppState.authenticated && !API.temSessaoNaMemoria(), 8000);
    const noAparelho = await q.A.evaluate(() => ({
      token: localStorage.getItem('waze_session_token'),
      quedas: JSON.parse(localStorage.getItem('waze_places_sessoes') || '[]').filter((l) => l.e === 'caiu').length,
    }));
    return { q, caiu, ...noAparelho };
  };
  const r3 = await quedaDaB({ aRenova: true });
  checa(r3.caiu.ok, 'duas abas: a aba B, com o token VELHO, não caiu no 401 confirmado (o percurso não mediu a queda)');
  checa(r3.token === 'tok-abas-novo', 'duas abas: a queda da aba B (token VELHO na memória) apagou do aparelho o token NOVO da aba A',
    String(r3.token));
  checa(r3.quedas === 1, 'duas abas: o diário de sessões não tem a queda UMA vez só (a da aba que a viu primeiro)', String(r3.quedas));
  // A A recarregada entra com a sessão guardada — antes, caía na tela de entrada.
  const redeAntesDaRecarga = r3.q.rede.length;
  await r3.q.A.reload({ waitUntil: 'domcontentloaded' });
  const aVoltou = await esperarNaPagina(r3.q.A, () => AppState.authenticated && !!AppState.profile, 8000);
  const tokensDaA = [...new Set(r3.q.rede.slice(redeAntesDaRecarga).map((x) => x.token).filter(Boolean))];
  checa(aVoltou.ok && tokensDaA.length === 1 && tokensDaA[0] === 'tok-abas-novo',
    'duas abas: a aba A recarregada não entrou com a sessão NOVA guardada', JSON.stringify(tokensDaA));
  checa(r3.q.erros.length === 0, 'duas abas: erro de JS na queda da aba B', r3.q.erros[0]);
  await r3.q.ctx.close();
  // CONTROLE: a sessão da B É a guardada (a A não renovou) — e a queda a tira
  // do aparelho como sempre. Sem isto, "o token ficou" passaria com uma queda
  // que nunca mexeu no aparelho.
  const c3 = await quedaDaB({ aRenova: false });
  checa(c3.caiu.ok && c3.token === null && c3.quedas === 1,
    'duas abas: CONTROLE — a queda da sessão GUARDADA (o mesmo token na memória e no aparelho) não a tirou do aparelho',
    JSON.stringify({ caiu: c3.caiu.ok, token: c3.token, quedas: c3.quedas }));
  await c3.q.ctx.close();

  // ── 4. OUTRA CONTA entra noutra aba ─────────────────────────────────────
  // Os dados do aparelho têm UM dono. A sessão da aba A cai e, na entrada dela,
  // alguém entra com OUTRA conta: a A tira do aparelho os dados da anterior, e
  // ele passa a ser da nova. A aba B, logada com a conta anterior (o perfil na
  // memória), seguia: o placar e o Histórico que ela grava iam pra conta nova,
  // e cada decisão dela na fila de saída era tirada pela A como "de outra
  // conta", sem ir ao Waze. Agora ela SAI — sem mexer no aparelho, destruindo
  // no servidor a sessão dela (que não é a do aparelho) e dizendo por quê.
  // CONTROLE: a MESMA conta entrando de novo na A não derruba a B.
  const o = await abrirAbas();
  const cookiesDa = (conta) => `.waze.com\tTRUE\t/\tTRUE\t0\t_web_session\tconta-${conta}`;
  // A QUEDA da sessão da aba A, até a entrada dela; e o login dela, à parte: entre
  // os dois, a aba B, VIVA com OUTRA sessão da mesma conta, volta a guardar a sua
  // no aparelho (R14-1-03, `guardarDeVoltaASessaoDestaAba`).
  const cairNaA = async () => {
    await o.A.evaluate(() => derrubarSessao('srv.err.sessionExpired'));
    await esperarOuExplodir(o.A, naEntrada, 'a aba A voltar à entrada depois da queda');
  };
  const logarNaA = async (conta) => {
    await o.A.evaluate((c) => authenticateWithCookies(c), cookiesDa(conta));
    await esperarOuExplodir(o.A, () => AppState.authenticated && !!AppState.profile
      && String(AppState.profile.id) === String(JSON.parse(localStorage.getItem('waze_places_conta') || '{}').id),
      `a aba A entrar com a conta ${conta}`);
  };
  // As duas abas com a MESMA sessão (`tok-abas`): a que caiu na A é a da B também,
  // e a B não a guarda de volta — o aparelho segue sem sessão até a A entrar. A A
  // leva mais que a espera da guarda pra chegar à entrada (a pergunta à extensão e
  // o redirecionamento): uma guarda agendada já teria gravado. É o CONTROLE da
  // medida do R14-1-03, logo abaixo.
  await cairNaA();
  const quedaComum = await o.B.evaluate(() => ({ token: localStorage.getItem('waze_session_token'), agendada: guardarDeVoltaAgendado !== null }));
  checa(quedaComum.token === null && !quedaComum.agendada,
    'duas abas: CONTROLE — a sessão que caiu na A era a da B também, e a B a guardou (ou agendou guardar) de volta no aparelho',
    JSON.stringify(quedaComum));
  await logarNaA(4242);
  await dormir(600);
  const bFica = await o.B.evaluate(() => ({ auth: AppState.authenticated, memoria: API.temSessaoNaMemoria(),
    card: !!document.querySelector('#cardStack .place-card:not(.card-fundo)') }));
  checa(bFica.auth && bFica.memoria && bFica.card, 'duas abas: CONTROLE — a MESMA conta entrando de novo na aba A derrubou a B',
    JSON.stringify(bFica));
  // Sem a B na fila (o controle reprovou), o resto não tem o que medir.
  if (bFica.auth && bFica.card) {
    // O espião de escrita na B (ver a seção 1), com o CONTROLE dele: o ✕ grava o placar.
    await o.B.evaluate(() => {
      window.__escritasDaB = [];
      for (const nome of ['setItem', 'removeItem', 'clear']) {
        const original = Storage.prototype[nome];
        Storage.prototype[nome] = function (...args) {
          if (this === localStorage) window.__escritasDaB.push(nome + ':' + (args[0] === undefined ? '' : args[0]));
          return original.apply(this, args);
        };
      }
    });
    await rejeitarNa(o.B);
    const espiou4 = await o.B.evaluate(() => window.__escritasDaB.slice());
    checa(espiou4.includes('setItem:waze_places_stats'),
      'duas abas: CONTROLE — o espião da aba B não viu o ✕ dela gravar o placar (ele estaria cego na troca de conta)', JSON.stringify(espiou4));
    const redeNaTroca = o.rede.length;
    // A sessão da A (a GUARDADA, `tok-abas-1`) cai, e a B segue viva com a sua
    // (`tok-abas`): a B volta a guardá-la, com a marca da conta (R14-1-03) — antes o
    // aparelho ficava sem sessão, e recarregar a B a levava à tela de entrada.
    await cairNaA();
    const guardouDeVolta = await esperarNaPagina(o.B, () => localStorage.getItem('waze_session_token') === 'tok-abas', 5000);
    const marcaNaB = await o.B.evaluate(() => {
      const c = JSON.parse(localStorage.getItem('waze_places_conta') || 'null');
      return { conta: c && c.id, marcaCerta: !!c && c.s === marcaDaSessao('tok-abas') };
    });
    checa(guardouDeVolta.ok && String(marcaNaB.conta) === '4242' && marcaNaB.marcaCerta,
      'duas abas: a sessão GUARDADA caiu na A e a B, viva e da mesma conta, não voltou a guardar a sua no aparelho (ou sem a marca da conta)',
      JSON.stringify(marcaNaB));
    // Daqui em diante o espião mede a SAÍDA da B pela troca de conta, que não mexe no
    // aparelho: as gravações da guarda acima (o token, a conta e o diário) eram da
    // conta dela, com o aparelho ainda dela.
    await o.B.evaluate(() => { window.__escritasDaB.length = 0; });
    await logarNaA(5151);
    const bSaiu4 = await esperarNaPagina(o.B, naEntrada, 5000);
    checa(bSaiu4.ok, 'duas abas: OUTRA conta entrou na aba A e a B seguiu logada com a anterior — o placar e o Histórico dela iriam pra conta nova');
    const b4 = await o.B.evaluate(() => ({ memoria: API.temSessaoNaMemoria(), perfil: !!AppState.profile,
      card: !!document.querySelector('#cardStack .place-card'),
      aviso: [...document.querySelectorAll('#toastContainer > *')].map((e) => e.textContent).join(' | ') }));
    checa(!b4.memoria && !b4.perfil && !b4.card, 'duas abas: a aba B ficou com a sessão, o perfil ou o card da conta anterior', JSON.stringify(b4));
    checa(/outra conta/i.test(b4.aviso), 'duas abas: a aba B saiu sem dizer que outra conta entrou', b4.aviso.slice(0, 160));
    const destruiu = o.rede.slice(redeNaTroca).filter((x) => x.rota === 'sessao' && x.acao === 'destroy');
    checa(destruiu.length === 1 && destruiu[0].token === 'tok-abas',
      'duas abas: a sessão da aba B (que não é a do aparelho) não foi destruída no servidor — ficaria órfã até vencer', JSON.stringify(destruiu));
    await dormir(500);
    const escritas4 = await o.B.evaluate(() => window.__escritasDaB.slice());
    checa(escritas4.length === 0, 'duas abas: a aba B mexeu no aparelho, que agora é da outra conta', JSON.stringify(escritas4));
    const dono = await o.A.evaluate(() => ({ conta: (JSON.parse(localStorage.getItem('waze_places_conta') || 'null') || {}).id,
      token: localStorage.getItem('waze_session_token'), auth: AppState.authenticated }));
    checa(String(dono.conta) === '5151' && dono.token === 'tok-outra' && dono.auth,
      'duas abas: o aparelho e a aba A não ficaram com a conta nova', JSON.stringify(dono));
  }
  checa(o.erros.length === 0, 'duas abas: erro de JS na troca de conta', o.erros[0]);
  await o.ctx.close();

  // ── 5. a decisão NO AR numa aba não sai de novo pela OUTRA ──────────────
  // Desde o O2 a decisão entra na fila de saída ANTES do envio, e a fila é do
  // aparelho: a outra aba, esvaziando (a resposta de qualquer chamada dela é
  // prova de rede), mandava de novo o ✕ que esta ainda tinha no ar, e o
  // Histórico o contava duas vezes (auditoria de 2026-10-01, R5-1 F1). Hoje a
  // anotação leva a marca da aba que manda. Aqui a resposta do ✕ da B fica
  // presa, e a A esvazia a fila nesse meio.
  // CONTROLE: o mesmo com a marca tirada da anotação (o app de antes) — a A
  // tem de mandá-lo de novo, senão a medida não enxerga o reenvio.
  const vooNaOutra = async ({ semMarca }) => {
    const v = await abrirAbas();
    const alvo = await v.B.evaluate(() => AppState.currentPlace.venueID);
    let soltar = () => {};
    v.segurar.set(alvo, new Promise((ok) => { soltar = ok; }));
    await v.B.evaluate(() => document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-reject').click());
    await esperarOuExplodir(v.A, () => JSON.parse(localStorage.getItem('waze_places_saida') || '[]').length === 1,
      'o ✕ da aba B ser anotado na fila de saída antes do envio');
    if (semMarca) {
      await v.A.evaluate(() => {
        const f = JSON.parse(localStorage.getItem('waze_places_saida'));
        for (const x of f) { delete x.rv; delete x.rvEm; }
        localStorage.setItem('waze_places_saida', JSON.stringify(f));
      });
    }
    await v.A.evaluate(() => esvaziarFilaDeSaida());
    soltar();
    await esperarNaPagina(v.B, () => AppState.inFlightActions === 0
      && (localStorage.getItem('waze_places_saida') || '[]') === '[]', 8000);
    await dormir(300);
    const envios = v.rede.filter((x) => x.rota === 'validar-place' && x.pedido === alvo).length;
    const hist = await v.A.evaluate(() => (JSON.parse(localStorage.getItem('waze_places_history') || '{}')._total || {}).rejected || 0);
    const erros = v.erros.slice();
    await v.ctx.close();
    return { envios, hist, erros };
  };
  const r5 = await vooNaOutra({ semMarca: false });
  checa(r5.envios === 1 && r5.hist === 1,
    'duas abas: o ✕ NO AR na aba B saiu de novo pela A (ou o Histórico o contou duas vezes)', JSON.stringify(r5));
  checa(r5.erros.length === 0, 'duas abas: erro de JS com a decisão no ar', r5.erros[0]);
  const c5 = await vooNaOutra({ semMarca: true });
  checa(c5.envios === 2,
    'duas abas: CONTROLE — sem a marca da aba, a A devia mandar de novo o ✕ no ar da B; a medida não enxerga o reenvio', JSON.stringify(c5));

  // ── 6. a aba SEM sessão não toma pra si a sessão que a OUTRA guardou ─────
  // O `getSession` do api.js, com a memória vazia, lê o aparelho e GRAVA na
  // memória o que leu, e as guardas da abertura e da volta à aba perguntavam
  // por ele "esta aba já entrou?" (auditoria de 2026-10-06, R9-1-03):
  //  (a) a aba que abre SEM sessão e pergunta à extensão, com a outra entrando
  //      nesse meio, ficava EM BRANCO (só o cabeçalho) até recarregar — agora
  //      ela adota a sessão, como numa abertura com sessão salva;
  //  (b) a aba da tela de entrada, depois de a pessoa voltar a ela, contava
  //      como logada, e o "Sair" da outra fechava o "Colar cookies" (apagando o
  //      que estava sendo colado) e dizia "Você saiu em outra aba".
  // A extensão de mentira (só na aba A da parte a) responde `aguarde` na hora —
  // o "Entrando pelo WME…" — e `sem-sessao` quando o TESTE manda: a outra aba
  // entra no meio, sem prazo fixo nenhum.
  // CONTROLES: ninguém entrando, a A cai na tela de entrada; e com a sessão da
  // outra puxada pra memória da A à mão (o que a guarda antiga fazia), a medida
  // tem de ver a tela em branco e o "Sair" encerrando a A.
  // Desde a rodada 10 (R10-1-03/04/05) a VOLTA à aba também adota (c), menos com
  // texto digitado num diálogo da entrada (b); a extensão que entra pela volta
  // leva o foco ao ✕ (d); e o link de pareamento que falha adota ou pergunta à
  // extensão (e).
  const telaDaAba = (page) => page.evaluate(() => {
    const vis = (id) => {
      const e = document.getElementById(id);
      if (!e || e.classList.contains('hidden')) return false;
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    };
    return { entrada: vis('authScreen'), app: vis('appScreen'), entrandoWme: vis('extLoginState'),
      auth: AppState.authenticated, memoria: API.temSessaoNaMemoria() };
  });
  const naFilaComCard = () => AppState.authenticated && !!AppState.currentPlace
    && !!document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-reject');
  const aberturaComAOutraEntrando = async ({ outraEntra, puxar = false }) => {
    const s = await abrirAbas({ semSessao: true });
    const B = await s.abrir();
    await esperarOuExplodir(B, () => !extPerguntando && !document.getElementById('authScreen').classList.contains('hidden'),
      'a aba B (sem sessão) chegar à tela de entrada');
    const A = await s.abrir(() => {
      window.addEventListener('message', (ev) => {
        const d = ev.data;
        if (d && d.source === 'wazeplaces' && d.action === 'precisa-de-sessao') {
          window.postMessage({ source: 'wazeplaces-ext', action: 'aguarde' }, location.origin);
        }
      });
      window.__extSemSessao = () => window.postMessage({ source: 'wazeplaces-ext', action: 'sem-sessao', motivo: 'sem-login-wme' },
        location.origin);
    });
    await esperarOuExplodir(A, () => extPerguntando && !document.getElementById('extLoginState').classList.contains('hidden'),
      'a aba A perguntar à extensão ("Entrando pelo WME…")');
    if (outraEntra) {
      await B.evaluate((c) => authenticateWithCookies(c), cookiesDa(4242));
      await esperarOuExplodir(A, () => !!localStorage.getItem('waze_session_token'), 'a sessão da aba B chegar ao aparelho');
    }
    if (puxar) await A.evaluate(() => { API.getSession(); });   // o que a guarda antiga fazia
    await A.evaluate(() => window.__extSemSessao());
    await esperarOuExplodir(A, () => !extPerguntando, 'a pergunta da aba A acabar');
    const tela = await telaDaAba(A);
    const comCard = outraEntra && !puxar ? await esperarNaPagina(A, naFilaComCard, 8000) : null;
    const adotou = await A.evaluate(() => !!API.sessionToken && API.sessionToken === localStorage.getItem('waze_session_token'));
    const erros = s.erros.slice();
    await s.ctx.close();
    return { tela, branca: !tela.entrada && !tela.app && !tela.entrandoWme, comCard, adotou, erros };
  };
  const r6a = await aberturaComAOutraEntrando({ outraEntra: true });
  checa(!r6a.branca, 'aba sem sessão: a abertura que perguntava à extensão ficou EM BRANCO com a sessão que a outra aba guardou',
    JSON.stringify(r6a.tela));
  checa(r6a.tela.app && r6a.adotou && r6a.comCard && r6a.comCard.ok,
    'aba sem sessão: a sessão que a outra aba guardou durante a pergunta não foi ADOTADA (o app, com a fila, como numa abertura com sessão salva)',
    JSON.stringify({ tela: r6a.tela, adotou: r6a.adotou, card: r6a.comCard && r6a.comCard.ok }));
  checa(r6a.erros.length === 0, 'aba sem sessão: erro de JS na abertura que adotou a sessão da outra', r6a.erros[0]);
  const c6a = await aberturaComAOutraEntrando({ outraEntra: false });
  checa(c6a.tela.entrada && !c6a.tela.app && !c6a.tela.memoria,
    'aba sem sessão: CONTROLE — ninguém entrou, e a aba A não caiu na tela de entrada no fim da pergunta (a medida não vê o fim dela)',
    JSON.stringify(c6a.tela));
  const d6a = await aberturaComAOutraEntrando({ outraEntra: true, puxar: true });
  checa(d6a.branca,
    'aba sem sessão: CONTROLE — com a sessão da outra puxada pra memória da A (a guarda antiga), a medida devia ver a tela EM BRANCO',
    JSON.stringify(d6a.tela));

  // As perguntas que a aba faz à extensão (o `precisa-de-sessao` da ponte), contadas.
  const contarPerguntas = () => {
    window.__perguntas = 0;
    window.addEventListener('message', (ev) => {
      const d = ev.data;
      if (d && d.source === 'wazeplaces' && d.action === 'precisa-de-sessao') window.__perguntas++;
    });
  };
  const paradaNaEntrada = () => !extPerguntando && !document.getElementById('authScreen').classList.contains('hidden');
  const COLANDO = 'TEXTO_QUE_ESTOU_COLANDO';

  // (b) a volta à aba da TELA DE ENTRADA com o "Colar cookies" DIGITADO: a sessão
  //     da outra não vai pra memória desta, e o "Sair" de lá não a encerra. A
  //     volta ADOTA a sessão da outra (R10-1-03, a parte c abaixo); o que a
  //     segura aqui é o texto digitado, que a adoção jogaria fora.
  const entradaComOSairDaOutra = async ({ puxar = false }) => {
    const s = await abrirAbas({ semSessao: true });
    const A = await s.abrir(contarPerguntas);
    await esperarOuExplodir(A, paradaNaEntrada, 'a aba A (sem sessão) chegar à tela de entrada');
    // CONTROLE do ouvinte: sem sessão nenhuma no aparelho, a volta à aba pergunta
    // à extensão — onde ela instala (o Chromium de computador; fora dele a volta
    // não pergunta nada).
    const temOuvinte = await A.evaluate(() => podeInstalarExtensao());
    const p0 = await A.evaluate(() => window.__perguntas);
    await A.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await esperarOuExplodir(A, paradaNaEntrada, 'a pergunta da volta à aba A acabar');
    const semSessaoPerguntou = (await A.evaluate(() => window.__perguntas)) - p0;
    // A pessoa abre o "Colar cookies" na A e cola; a aba B entra pelos cookies; a pessoa volta à A.
    await A.evaluate(() => document.getElementById('pasteBtn').click());
    await esperarOuExplodir(A, () => !document.getElementById('pasteModal').classList.contains('hidden'), 'o "Colar cookies" abrir na aba A');
    await A.evaluate((t) => { document.getElementById('cookiesTextarea').value = t; }, COLANDO);
    const B = await s.abrir();
    await esperarOuExplodir(B, paradaNaEntrada, 'a aba B (sem sessão) chegar à tela de entrada');
    await B.evaluate((c) => authenticateWithCookies(c), cookiesDa(4242));
    await esperarOuExplodir(B, naFilaComCard, 'a aba B entrar pelos cookies');
    const p1 = await A.evaluate(() => window.__perguntas);
    await A.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    if (puxar) await A.evaluate(() => { API.getSession(); });   // o que a guarda antiga fazia
    // A adoção é SÍNCRONA no ouvinte da volta: lida logo depois, ela já teria acontecido.
    const naVolta = await A.evaluate(() => ({ memoria: API.temSessaoNaMemoria(), perguntando: extPerguntando,
      colar: !document.getElementById('pasteModal').classList.contains('hidden'),
      campo: document.getElementById('cookiesTextarea').value,
      entrada: !document.getElementById('authScreen').classList.contains('hidden') }));
    const comSessaoPerguntou = (await A.evaluate(() => window.__perguntas)) - p1;
    await A.evaluate(() => {
      window.__sairChegou = false;
      window.addEventListener('storage', () => {
        if (!localStorage.getItem('waze_session_token') && !localStorage.getItem('waze_places_conta')) window.__sairChegou = true;
      });
    });
    await sairPelaAjuda(B);
    await esperarOuExplodir(B, naEntrada, 'a aba B voltar à entrada depois do "Sair"');
    await esperarOuExplodir(A, () => window.__sairChegou, 'o aviso do "Sair" da B chegar à aba A');
    const encerrou = await esperarNaPagina(A, () => document.getElementById('pasteModal').classList.contains('hidden')
      || [...document.querySelectorAll('#toastContainer > *')].some((e) => /outra aba/.test(e.textContent)), 1500);
    const fim = await A.evaluate(() => ({
      colar: !document.getElementById('pasteModal').classList.contains('hidden'),
      campo: document.getElementById('cookiesTextarea').value,
      avisos: [...document.querySelectorAll('#toastContainer > *')].map((e) => e.textContent.trim()),
    }));
    const erros = s.erros.slice();
    await s.ctx.close();
    return { temOuvinte, semSessaoPerguntou, comSessaoPerguntou, naVolta, encerrou: encerrou.ok, fim, erros };
  };
  const r6b = await entradaComOSairDaOutra({});
  checa(MOTOR !== 'chromium' || r6b.temOuvinte,
    'aba sem sessão: CONTROLE — no Chromium de computador a volta à aba devia perguntar à extensão; sem isso a parte (b) não mede a pergunta');
  checa(r6b.semSessaoPerguntou === (r6b.temOuvinte ? 1 : 0),
    'aba sem sessão: CONTROLE — sem sessão no aparelho, a volta à aba devia perguntar à extensão onde ela instala (e só lá)',
    JSON.stringify({ temOuvinte: r6b.temOuvinte, perguntas: r6b.semSessaoPerguntou }));
  checa(!r6b.naVolta.memoria, 'aba sem sessão: a volta à aba com o "Colar cookies" digitado gravou na memória dela a sessão que a outra aba guardou');
  checa(r6b.naVolta.colar && r6b.naVolta.campo === COLANDO && r6b.naVolta.entrada,
    'aba sem sessão: a volta à aba fechou o "Colar cookies" digitado — a adoção da sessão da outra jogou fora o que a pessoa colava',
    JSON.stringify(r6b.naVolta));
  checa(r6b.comSessaoPerguntou === 0 && !r6b.naVolta.perguntando,
    'aba sem sessão: com a sessão da outra aba no aparelho, a volta à aba perguntou à extensão (uma sessão nova por cima da guardada)');
  checa(!r6b.encerrou && r6b.fim.colar && r6b.fim.campo === COLANDO,
    'aba sem sessão: o "Sair" da outra aba encerrou a aba da tela de entrada — o "Colar cookies" fechou e o que era colado sumiu',
    JSON.stringify(r6b.fim));
  checa(!r6b.fim.avisos.some((x) => /outra aba/.test(x)), 'aba sem sessão: "Você saiu em outra aba" numa aba que nunca entrou',
    r6b.fim.avisos.join(' | '));
  checa(r6b.erros.length === 0, 'aba sem sessão: erro de JS na volta à aba e no "Sair" da outra', r6b.erros[0]);
  const d6b = await entradaComOSairDaOutra({ puxar: true });
  checa(d6b.naVolta.memoria && d6b.encerrou && !d6b.fim.colar,
    'aba sem sessão: CONTROLE — com a sessão da outra na memória da A (a guarda antiga), o "Sair" de lá devia encerrar a A; a medida não enxerga',
    JSON.stringify({ memoria: d6b.naVolta.memoria, encerrou: d6b.encerrou, fim: d6b.fim }));

  // ── (c) a volta à aba da tela de entrada ADOTA a sessão da outra (R10-1-03) ──
  // A pessoa entrou pela aba B e voltou à A, parada no "Bem-vindo!": a A seguia
  // ali, sem perguntar nada a ninguém, até recarregar — e o ouvinte da volta só
  // existia onde a extensão instala (auditoria da rodada 10, R10-1-03).
  // DECIDIDO como o R9-1-03: a volta adota como a abertura, em TODO aparelho
  // (aqui, nos dois motores; no WebKit a extensão nem é perguntada). E o foco que
  // estava NA tela de entrada vai ao ✕ do primeiro card: ele caía no <body>, e o
  // Tab seguinte ia ao mapa do card (R10-1-05).
  // CONTROLES: antes da volta a A segue na entrada (quem adota é a VOLTA); com o
  // ouvinte da volta TIRADO (o app de antes no celular), a medida vê a A parada no
  // "Bem-vindo!"; com o foco no <body> (ninguém na tela de entrada), ele não vai
  // ao ✕.
  const focoNoX = () => {
    const x = cardDaFrente() && cardDaFrente().querySelector('.card-btn-reject');
    return !!x && document.activeElement === x;
  };
  // Onde está o foco, num rótulo curto (o id, ou o tipo de elemento).
  const ondeEstaOFoco = (page) => page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return 'BODY';
    return a.id || (a.classList && a.classList.contains('card-btn-reject') ? '✕' : a.tagName);
  });
  // O foco na tela de entrada: no "Colar cookies" (`pasteBtn`), no campo dele com o
  // diálogo aberto e VAZIO (`cookiesTextarea`), ou em lugar nenhum (`null`: o <body>).
  const porOFoco = async (A, foco) => {
    if (foco === 'cookiesTextarea') {
      await A.evaluate(() => document.getElementById('pasteBtn').click());
      await esperarOuExplodir(A, () => !document.getElementById('pasteModal').classList.contains('hidden'), 'o "Colar cookies" abrir na aba A');
      await A.focus('#cookiesTextarea');
    } else if (foco) await A.focus('#' + foco);
    else await A.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  };
  const voltaComASessaoDaOutra = async ({ foco = 'pasteBtn', semOuvinte = false } = {}) => {
    const s = await abrirAbas({ semSessao: true });
    const A = await s.abrir(contarPerguntas);
    await esperarOuExplodir(A, paradaNaEntrada, 'a aba A (sem sessão) chegar à tela de entrada');
    if (semOuvinte) await A.evaluate(() => { if (typeof aoVoltarAAba === 'function') document.removeEventListener('visibilitychange', aoVoltarAAba); });
    await porOFoco(A, foco);
    const B = await s.abrir();
    await esperarOuExplodir(B, paradaNaEntrada, 'a aba B (sem sessão) chegar à tela de entrada');
    await B.evaluate((c) => authenticateWithCookies(c), cookiesDa(4242));
    await esperarOuExplodir(B, naFilaComCard, 'a aba B entrar pelos cookies');
    const antesDaVolta = await telaDaAba(A);
    const focoAntes = await ondeEstaOFoco(A);
    const p1 = await A.evaluate(() => window.__perguntas);
    await A.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    // A adoção é SÍNCRONA no ouvinte: a memória já diz se ela aconteceu.
    const naVolta = await A.evaluate(() => ({ memoria: API.sessionToken, guardado: localStorage.getItem('waze_session_token') }));
    const comCard = naVolta.memoria ? await esperarNaPagina(A, naFilaComCard, 8000) : { ok: false };
    // O foco pousa quando o card nasce e destrava (`aplicarFocoDoTeclado`, depois da tarefa): espera a CONDIÇÃO, com teto.
    const foiAoX = comCard.ok ? await esperarNaPagina(A, focoNoX, 3000) : { ok: false };
    if (comCard.ok && !foiAoX.ok) await doisQuadros(A);
    const tela = await telaDaAba(A);
    const focoDepois = await ondeEstaOFoco(A);
    const colarAberto = await A.evaluate(() => !document.getElementById('pasteModal').classList.contains('hidden'));
    const perguntas = (await A.evaluate(() => window.__perguntas)) - p1;
    const erros = s.erros.slice();
    await s.ctx.close();
    return { antesDaVolta, focoAntes, naVolta, comCard: comCard.ok, foiAoX: foiAoX.ok, tela, focoDepois, colarAberto, perguntas, erros };
  };
  for (const foco of ['pasteBtn', 'cookiesTextarea']) {
    const r6c = await voltaComASessaoDaOutra({ foco });
    checa(r6c.focoAntes === foco, `volta à aba (${foco}): PRÉ-CONDIÇÃO — o foco não estava na tela de entrada antes da volta`, r6c.focoAntes);
    checa(r6c.antesDaVolta.entrada && !r6c.antesDaVolta.memoria,
      `volta à aba (${foco}): CONTROLE — a aba A adotou a sessão da B antes de a pessoa voltar a ela (quem adota tem de ser a VOLTA)`,
      JSON.stringify(r6c.antesDaVolta));
    checa(r6c.naVolta.memoria && r6c.naVolta.memoria === r6c.naVolta.guardado && r6c.comCard && r6c.tela.app && !r6c.tela.entrada,
      `volta à aba (${foco}): a aba da tela de entrada não ADOTOU a sessão que a outra guardou — seguiu no "Bem-vindo!" até recarregar`,
      JSON.stringify({ naVolta: r6c.naVolta, comCard: r6c.comCard, tela: r6c.tela }));
    checa(r6c.perguntas === 0, `volta à aba (${foco}): com a sessão da outra no aparelho, a volta perguntou à extensão`, String(r6c.perguntas));
    checa(!r6c.colarAberto, `volta à aba (${foco}): o "Colar cookies" vazio ficou aberto por cima do app`);
    checa(r6c.foiAoX, `volta à aba (${foco}): o foco que estava na tela de entrada não foi ao ✕ do primeiro card (R10-1-05)`, r6c.focoDepois);
    checa(r6c.erros.length === 0, `volta à aba (${foco}): erro de JS`, r6c.erros[0]);
  }
  const c6c = await voltaComASessaoDaOutra({ foco: null });
  checa(c6c.focoAntes === 'BODY', 'volta à aba (foco no <body>): PRÉ-CONDIÇÃO — o foco não estava no <body>', c6c.focoAntes);
  checa(c6c.comCard, 'volta à aba (foco no <body>): PRÉ-CONDIÇÃO — a volta não adotou a sessão da outra (o controle abaixo não mede nada)');
  checa(!c6c.foiAoX, 'volta à aba: CONTROLE — com o foco no <body> (ninguém na tela de entrada), a adoção levou o foco ao ✕ mesmo assim',
    c6c.focoDepois);
  const d6c = await voltaComASessaoDaOutra({ semOuvinte: true });
  checa(!d6c.naVolta.memoria && d6c.tela.entrada && !d6c.tela.app,
    'volta à aba: CONTROLE — sem o ouvinte da volta (o app de antes, no celular), a medida devia ver a aba A parada no "Bem-vindo!"',
    JSON.stringify({ naVolta: d6c.naVolta, tela: d6c.tela }));

  // ── (d) a EXTENSÃO que entra pela volta à aba leva o foco ao ✕ (R10-1-05) ────
  // Na tela de entrada com o foco no campo do "Colar cookies", a pessoa troca de
  // aba e volta; a extensão entra em silêncio, a tela de entrada some com o foco
  // nela, e ele caía no <body>: o Tab seguinte ia ao mapa do card (auditoria da
  // rodada 10, R10-1-05). A extensão de mentira só responde depois de o teste a
  // LIGAR. A pergunta da volta só existe onde a extensão instala; no WebKit ela
  // é feita pela mesma função que o ouvinte chama ali (`perguntarAExtensaoAoVoltar`).
  // CONTROLE: com o foco no <body>, a extensão entra e o foco não vai ao ✕.
  const extensaoQueEntraQuandoLigada = () => {
    window.__extLigada = false;
    window.__perguntas = 0;
    window.addEventListener('message', (ev) => {
      const d = ev.data;
      if (!window.__extLigada || !d || d.source !== 'wazeplaces' || d.action !== 'precisa-de-sessao') return;
      window.__perguntas++;
      window.postMessage({ source: 'wazeplaces-ext', action: 'aguarde' }, location.origin);
      setTimeout(() => window.postMessage({ source: 'wazeplaces-ext', action: 'sessao', token: 'tok-abas-ext', conta: '4242' },
        location.origin), 300);
    });
  };
  const extensaoNaVolta = async ({ foco }) => {
    const s = await abrirAbas({ semSessao: true });
    const A = await s.abrir(extensaoQueEntraQuandoLigada);
    await esperarOuExplodir(A, paradaNaEntrada, 'a aba A (sem sessão) chegar à tela de entrada');
    await porOFoco(A, foco);
    const focoAntes = await ondeEstaOFoco(A);
    await A.evaluate(() => {
      window.__extLigada = true;
      if (podeInstalarExtensao()) document.dispatchEvent(new Event('visibilitychange'));
      else perguntarAExtensaoAoVoltar();
    });
    // A condição vai SERIALIZADA pra página: nada do Node dentro dela (o `naFilaComCard`
    // daqui chegava lá indefinido, e a espera virava um teto de 8 s que nunca confirmava).
    const entrou = await esperarNaPagina(A, () => AppState.authenticated && !!AppState.currentPlace
      && !!document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-reject') && API.sessionToken === 'tok-abas-ext', 8000);
    const foiAoX = entrou.ok ? await esperarNaPagina(A, focoNoX, 3000) : { ok: false };
    if (entrou.ok && !foiAoX.ok) await doisQuadros(A);
    const focoDepois = await ondeEstaOFoco(A);
    // O Tab seguinte: do ✕ ele vai ao ↑ do card (antes, do <body> ia ao mapa).
    await A.keyboard.press('Tab');
    const depoisDoTab = await A.evaluate(() => {
      const a = document.activeElement;
      return a ? (a.classList && a.classList.contains('card-btn-skip') ? '↑' : a.id || String(a.className).split(' ')[0] || a.tagName) : null;
    });
    const erros = s.erros.slice();
    await s.ctx.close();
    return { focoAntes, entrou: entrou.ok, foiAoX: foiAoX.ok, focoDepois, depoisDoTab, erros };
  };
  const r6d = await extensaoNaVolta({ foco: 'cookiesTextarea' });
  checa(r6d.focoAntes === 'cookiesTextarea' && r6d.entrou,
    'extensão na volta: PRÉ-CONDIÇÃO — o foco não estava no campo do "Colar cookies", ou a extensão não entrou', JSON.stringify(r6d));
  checa(r6d.foiAoX && r6d.depoisDoTab === '↑',
    'extensão na volta: o foco que estava no "Colar cookies" caiu no <body> quando a extensão entrou — o Tab seguinte não vai ao ↑ do card',
    JSON.stringify({ foco: r6d.focoDepois, tab: r6d.depoisDoTab }));
  checa(r6d.erros.length === 0, 'extensão na volta: erro de JS', r6d.erros[0]);
  const c6d = await extensaoNaVolta({ foco: null });
  checa(c6d.focoAntes === 'BODY' && c6d.entrou,
    'extensão na volta (foco no <body>): PRÉ-CONDIÇÃO — o foco não estava no <body>, ou a extensão não entrou', JSON.stringify(c6d));
  checa(!c6d.foiAoX, 'extensão na volta: CONTROLE — com o foco no <body>, a extensão entrou e o foco foi ao ✕ mesmo assim', c6d.focoDepois);

  // ── (e) o link de pareamento que FALHA, sem sessão salva (R10-1-04) ─────────
  // O link vencido (o QR de ontem) aberto sem sessão salva deixava a pessoa no
  // "Bem-vindo!" com o "Código inválido": a abertura pelo link não pergunta à
  // extensão, e a sessão que outra aba guardou durante o resgate não era adotada
  // (auditoria da rodada 10, R10-1-04). Agora: com a sessão da outra no aparelho,
  // ela entra (sem pergunta); sem ela, a extensão é perguntada como na abertura
  // comum. O aviso do código inválido fica — o resgate é que o mostra, e ninguém
  // o tira antes da hora (ele vive 4 s).
  // CONTROLE: sem extensão e sem outra aba, a A pergunta, ninguém responde, e
  // ela fica na tela de entrada com o aviso.
  const extensaoLigada = () => {
    window.__perguntas = 0;
    window.addEventListener('message', (ev) => {
      const d = ev.data;
      if (!d || d.source !== 'wazeplaces' || d.action !== 'precisa-de-sessao') return;
      window.__perguntas++;
      window.postMessage({ source: 'wazeplaces-ext', action: 'aguarde' }, location.origin);
      setTimeout(() => window.postMessage({ source: 'wazeplaces-ext', action: 'sessao', token: 'tok-abas-ext', conta: '4242' },
        location.origin), 300);
    });
  };
  const vigiarAvisoDoCodigo = () => {
    window.__avisoDoCodigo = null;
    new MutationObserver((ms) => {
      for (const m of ms) {
        for (const n of m.addedNodes) {
          if (!window.__avisoDoCodigo && n.nodeType === 1 && m.target && m.target.id === 'toastContainer'
            && /Código inválido/.test(n.textContent || '')) window.__avisoDoCodigo = { el: n, em: performance.now(), saiu: null };
        }
        for (const n of m.removedNodes) if (window.__avisoDoCodigo && n === window.__avisoDoCodigo.el) window.__avisoDoCodigo.saiu = performance.now();
      }
    }).observe(document, { childList: true, subtree: true });
  };
  const linkVencido = async ({ extensao = false, outraEntra = false } = {}) => {
    const s = await abrirAbas({ semSessao: true });
    let soltar = () => {};
    if (outraEntra) s.resgate.segurar = new Promise((ok) => { soltar = ok; });
    let B = null;
    if (outraEntra) {
      B = await s.abrir();
      await esperarOuExplodir(B, paradaNaEntrada, 'a aba B (sem sessão) chegar à tela de entrada');
    }
    // A extensão LIGADA desde o começo: a abertura pelo link não a pergunta, e a
    // pergunta que vier depois do resgate não pode correr com o teste ligando-a.
    const A = await s.abrir([extensao ? extensaoLigada : contarPerguntas, vigiarAvisoDoCodigo], '#pair=ABCDEFGHJKLMNPQRSTUV');
    if (outraEntra) {
      await esperarOuExplodir(A, () => !document.getElementById('authScreen').classList.contains('hidden'),
        'a aba A mostrar a tela de entrada durante o resgate');
      await B.evaluate((c) => authenticateWithCookies(c), cookiesDa(4242));
      await esperarOuExplodir(B, naFilaComCard, 'a aba B entrar pelos cookies durante o resgate da A');
      soltar();
    }
    // O FIM: o app com o card, ou a tela de entrada depois de o aviso sair e a pergunta acabar.
    const fim = await esperarNaPagina(A, () => (AppState.authenticated && !!AppState.currentPlace
      && !!document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-reject')) || (!!window.__avisoDoCodigo && !extPerguntando
      && !document.getElementById('authScreen').classList.contains('hidden') && document.getElementById('extLoginState').classList.contains('hidden')
      && (window.__perguntas || 0) > 0), 10000);
    const tela = await telaDaAba(A);
    const r = await A.evaluate(() => {
      const a = window.__avisoDoCodigo;
      return { memoria: API.sessionToken, guardado: localStorage.getItem('waze_session_token'), perguntas: window.__perguntas || 0,
        aviso: a ? { durouMs: Math.round((a.saiu === null ? performance.now() : a.saiu) - a.em), saiu: a.saiu !== null } : null };
    });
    const resgates = s.rede.filter((x) => x.rota === 'parear' && x.acao === 'claim').length;
    const erros = s.erros.slice();
    await s.ctx.close();
    return { fim: fim.ok, tela, ...r, resgates, erros };
  };
  const avisoInteiro = (x) => !!x.aviso && (!x.aviso.saiu || x.aviso.durouMs >= 3500);
  const r6e = await linkVencido({ extensao: true });
  checa(r6e.resgates === 1, 'link vencido (extensão): PRÉ-CONDIÇÃO — o link não fez o resgate do código', String(r6e.resgates));
  checa(r6e.fim && r6e.tela.app && r6e.memoria === 'tok-abas-ext' && r6e.perguntas === 1,
    'link vencido: sem sessão salva, o código recusado deixou a pessoa no "Bem-vindo!" — a extensão não foi perguntada como na abertura',
    JSON.stringify({ tela: r6e.tela, memoria: r6e.memoria, perguntas: r6e.perguntas }));
  checa(avisoInteiro(r6e), 'link vencido (extensão): o aviso do código inválido sumiu antes da hora (ou nem saiu)', JSON.stringify(r6e.aviso));
  checa(r6e.erros.length === 0, 'link vencido (extensão): erro de JS', r6e.erros[0]);
  const o6e = await linkVencido({ outraEntra: true });
  checa(o6e.fim && o6e.tela.app && !!o6e.memoria && o6e.memoria === o6e.guardado && o6e.perguntas === 0,
    'link vencido: a sessão que a outra aba guardou durante o resgate não entrou (ou a extensão foi perguntada por cima dela)',
    JSON.stringify({ tela: o6e.tela, memoria: o6e.memoria, guardado: o6e.guardado, perguntas: o6e.perguntas }));
  checa(avisoInteiro(o6e), 'link vencido (outra aba): o aviso do código inválido sumiu antes da hora (ou nem saiu)', JSON.stringify(o6e.aviso));
  checa(o6e.erros.length === 0, 'link vencido (outra aba): erro de JS', o6e.erros[0]);
  const c6e = await linkVencido({});
  checa(c6e.fim && c6e.tela.entrada && !c6e.memoria && c6e.perguntas === 1 && avisoInteiro(c6e),
    'link vencido: CONTROLE — sem extensão e sem outra aba, a A devia perguntar à extensão UMA vez e ficar na tela de entrada com o aviso',
    JSON.stringify({ fim: c6e.fim, tela: c6e.tela, memoria: c6e.memoria, perguntas: c6e.perguntas, aviso: c6e.aviso }));
}

// ── "SAIR" É LIMPAR DE TUDO — o DOM também (auditoria de 2026-10-02, R6-1-05) ──
//
// O armazenamento já saía inteiro no "Sair", mas o DOM da tela de entrada
// seguia com dado de TERCEIRO: a lista de autores rejeitados do Histórico, a
// folha do autor, a última foto ampliada (o nome do local, o de quem mandou a
// foto e o `alt`) e o perfil de quem o portão recusou. Na mesma página, a
// próxima conta que ligasse o modo dev levava isso no relatório (o DOM inteiro
// vai nele). Os pedidos daqui têm uma MARCA no nome do local, no endereço e no
// autor, e a página é VARRIDA por ela — texto e atributos. CONTROLE: com cada
// camada ABERTA, a varredura acha a marca no nó dela (sem isto, "nada achado"
// passaria com a varredura cega). Cada camada fecha por um caminho diferente
// (Esc, o fundo, o ✕, o voltar), e o "Sair" é pela Ajuda, como a pessoa faz.
{
  const MARCA = 'PRIVSAIR';
  const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const PERFIL_SAIR = { id: 4242, userName: 'editor_sair', rank: 5, isAreaManager: true, isStaff: false,
    editableCountryIDs: [30], areas: [], managedAreas: [] };
  // Pedidos de FOTO NOVA do MESMO autor: dois ✕ o promovem à lista de autores.
  const FILA_SAIR = Array.from({ length: 5 }, (_, i) => ({
    venueID: `vsair${i}`, updateRequestID: `usair${i}`, name: `Padaria${MARCA}${i}`, categories: ['BAKERY'],
    address: `Rua${MARCA} ${i}, 10`, updateType: 'Nova foto', updateTypeKey: 'IMAGE', reqType: 'IMAGE', purType: 'NEW_PHOTO',
    createdBy: `autor${MARCA}`, creatorId: 7777, imageUrls: [`https://venue-image.waze.com/thumbs/thumb700_usair${i}.png`],
    newImageIdx: 0, approvedImageIds: [], localAprovado: true, brand: null, changes: [],
    // Uma entrada com NOME (de terceiro): o mapa ampliado o põe no `title` do marcador (R7-1-02).
    mapa: { centro: [-23.5 + i / 1000, -46.6], proposto: null, movidoM: null,
      entradas: [{ ll: [-23.5 + i / 1000 + 0.0002, -46.6002], estado: 'nova', nome: `Entrada${MARCA}${i}`, distM: 25 }] },
    lat: -23.5 + i / 1000, lon: -46.6,
  }));
  const NEGADO = { success: false, error: 'Acesso restrito', errorKey: 'srv.err.accessDenied', errorVars: { minLevel: 2 },
    errorCategory: 'access_denied', profile: { userName: `editor${MARCA}`, rank: 0, isAreaManager: false, isStaff: false } };
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block', locale: 'pt-BR' });
  await ctx.route('**/*.waze.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
  await ctx.route('**/api/**', async (r) => {
    const rota = new URL(r.request().url()).pathname.replace(/^\/api\//, '');
    const json = (o, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (rota === 'perfil') return json({ success: true, profile: PERFIL_SAIR, visivelNoWme: true });
    if (rota === 'buscar-places') return json({ success: true, places: FILA_SAIR, hasMore: false, page: 1,
      total: FILA_SAIR.length, totalAll: FILA_SAIR.length, blocked: 0 });
    if (rota === 'lista-paises') return json({ success: true, countries: [{ id: 30, name: 'Brazil', abbr: 'BR' }] });
    if (rota === 'presenca-app') return json({ success: true, online: [], conversas: [] });
    if (rota === 'testar-cookies') return json(NEGADO, 403);
    return json({ success: true });
  });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e.message || e).slice(0, 160)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  // A cota do Desfazer cumprida (L6: 10) e o Desfazer desligado: o ✕ sai na hora.
  await page.evaluate(() => {
    localStorage.setItem('waze_session_token', 'tok-sair');
    localStorage.setItem('waze_places_stats', JSON.stringify({ read: 0, rejected: 20, skipped: 0 }));
    localStorage.setItem('waze_places_preferences', JSON.stringify({ undoEnabled: false, presenca: true, undoGateSeen: true,
      dicaDesfazerVista: true, comoFuncionaVisto: true, consequenciaVista: { reject: true, read: true } }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await esperarOuExplodir(page, () => AppState.authenticated && !!AppState.profile && !!AppState.currentPlace
    && !!document.querySelector('#cardStack .place-card:not(.card-fundo) .card-btn-reject'), 'o app abrir com a fila do "Sair"');
  // A VARREDURA: em que nó (o id do ancestral mais próximo) a marca aparece,
  // no texto ou num atributo.
  const varrer = () => page.evaluate((marca) => {
    const achou = new Set();
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = tw.currentNode; n; n = tw.nextNode()) {
      let txt = '';
      if (n.nodeType === 3) txt = n.nodeValue;
      else for (const a of n.attributes || []) txt += ' ' + a.value;
      if (!txt.includes(marca)) continue;
      for (let e = n.nodeType === 3 ? n.parentElement : n; e; e = e.parentElement) if (e.id) { achou.add(e.id); break; }
    }
    return [...achou].sort();
  }, MARCA);
  const tocar = (seletor) => page.evaluate((s) => document.querySelector(s).click(), seletor);
  const assentarCamada = () => doisQuadros(page);
  // Dois ✕ do mesmo autor: ele entra na lista de autores rejeitados.
  // (O pedido de antes fica NA PÁGINA: a espera não leva argumento, e variável
  // do Node dentro dela chegaria `undefined` — gotcha #28.)
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => { window.__sairAntesDoX = AppState.currentPlace && AppState.currentPlace.updateRequestID; });
    await tocar('#cardStack .place-card:not(.card-fundo) .card-btn-reject');
    await esperarOuExplodir(page, () => !!AppState.currentPlace && AppState.currentPlace.updateRequestID !== window.__sairAntesDoX
      && AppState.inFlightActions === 0, `o ✕ ${i + 1} pousar e o card trocar`);
  }
  // A folha do autor, aberta; fecha pelo Esc.
  await page.evaluate(() => abrirFolhaDoAutor(AppState.currentPlace));
  await esperarOuExplodir(page, () => !document.getElementById('autorModal').classList.contains('hidden'), 'a folha do autor abrir');
  const comFolha = await varrer();
  await page.keyboard.press('Escape');
  await esperarOuExplodir(page, () => document.getElementById('autorModal').classList.contains('hidden'), 'o Esc fechar a folha');
  // O Histórico, com a lista de autores; fecha pelo FUNDO (o clique no scrim).
  await tocar('#filtersBtn');
  await esperarOuExplodir(page, () => !document.getElementById('filtersModal').classList.contains('hidden'), 'os Filtros abrirem');
  await tocar('#filtersTabHistory');
  await assentarCamada();
  const comHistorico = await varrer();
  // O RESTO do painel do Histórico (R8-7-06, auditoria de 2026-10-03): a patente,
  // os totais e o botão do Resumo são o trabalho de quem estava — números, sem a
  // marca, então medidos pelo tamanho do texto. Ficavam no DOM do painel fechado.
  const historicoAberto = await page.evaluate(() => document.getElementById('historyBody').textContent.trim().length);
  await page.evaluate(() => document.getElementById('filtersModal').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await esperarOuExplodir(page, () => document.getElementById('filtersModal').classList.contains('hidden'), 'o fundo fechar os Filtros');
  const historicoFechado = await page.evaluate(() => document.getElementById('historyBody').innerHTML.length);
  checa(historicoAberto > 0, 'sair/DOM: CONTROLE — o painel do Histórico aberto não tinha texto (a medida não enxerga o painel)',
    String(historicoAberto));
  checa(historicoFechado === 0, 'sair/DOM: o painel do Histórico FECHADO seguiu com a patente e os totais no DOM', String(historicoFechado));
  // A foto ampliada do card; fecha pelo ✕.
  await page.evaluate(() => { const p = AppState.currentPlace; openLightbox(p.imageUrls, 0, 0, p.name, false, p); });
  await esperarOuExplodir(page, () => Lightbox.isOpen(), 'a foto ampliada abrir');
  await assentarCamada();
  const comFoto = await varrer();
  await tocar('#lightboxClose');
  await esperarOuExplodir(page, () => !Lightbox.isOpen(), 'o ✕ fechar a foto');
  // O MAPA ampliado do card (R7-1-02, auditoria de 2026-10-02): o nome da
  // entrada no `title` do marcador, o link do Street View com a coordenada do
  // pedido e os tiles da área ficavam no mapa FECHADO — até depois do "Sair".
  // Fecha pelo VOLTAR do aparelho (o caminho do `close(viaHistorico)`).
  await page.evaluate(() => MapaLightbox.open(AppState.currentPlace));
  await esperarOuExplodir(page, () => MapaLightbox.isOpen() && document.querySelectorAll('#mapaLbTiles img').length > 0,
    'o mapa ampliado abrir com tiles');
  await assentarCamada();
  const comMapa = await varrer();
  const mapaAberto = await page.evaluate(() => ({ sv: document.getElementById('mapaLbStreetView').getAttribute('href'),
    tiles: document.querySelectorAll('#mapaLbTiles img').length, pontos: MapaLightbox.pontos.length }));
  await page.evaluate(() => history.back());
  await esperarOuExplodir(page, () => !MapaLightbox.isOpen() && !CamadaVoltar.consumindo, 'o voltar fechar o mapa ampliado');
  const mapaFechado = await page.evaluate(() => ({ sv: document.getElementById('mapaLbStreetView').getAttribute('href'),
    tiles: document.querySelectorAll('#mapaLbTiles img').length, marcas: document.querySelectorAll('#mapaLbMarks *').length,
    pontos: MapaLightbox.pontos.length, centro: MapaLightbox.centro, local: MapaLightbox._local }));
  checa(comFolha.includes('autorTitle') && comHistorico.includes('autoresBody') && comFoto.includes('lightboxCount')
      && comFoto.includes('lightboxNomeTxt') && comMapa.includes('mapaLbMarks') && !!mapaAberto.sv && mapaAberto.tiles > 0
      && mapaAberto.pontos > 0,
    'sair/DOM: CONTROLE — com as camadas abertas, a varredura não viu a marca nos nós delas (ela está cega)',
    JSON.stringify({ comFolha, comHistorico, comFoto, comMapa, mapaAberto }));
  const fechadas = (await varrer()).filter((id) => ['autorTitle', 'autorCorpo', 'autoresBody', 'lightboxCount', 'lightboxNomeTxt',
    'lightboxImage', 'mapaLbMarks', 'mapaLbLegenda', 'mapaLbTiles', 'mapaLbStreetView'].includes(id));
  checa(fechadas.length === 0, 'sair/DOM: a camada FECHADA (Esc, fundo, ✕, voltar) seguiu com dado de terceiro no DOM', JSON.stringify(fechadas));
  checa(mapaFechado.sv === null && mapaFechado.tiles === 0 && mapaFechado.marcas === 0 && mapaFechado.pontos === 0
      && mapaFechado.centro === null && mapaFechado.local === null,
    'sair/DOM: o mapa ampliado FECHADO guardou o pedido (o link do Street View, os tiles, os marcadores ou os pontos na memória)',
    JSON.stringify(mapaFechado));
  // A folha do autor redesenha o painel do Histórico com os Filtros FECHADOS (o
  // "Esquecer" dela): o painel volta ao DOM escondido, e o "Sair" tem que tirá-lo
  // (R8-7-06). CONTROLE: o redesenho escondido aconteceu.
  await page.evaluate(() => abrirFolhaDoAutor(AppState.currentPlace));
  await esperarOuExplodir(page, () => !document.getElementById('autorModal').classList.contains('hidden'), 'a folha do autor abrir de novo');
  await tocar('#autorEsquecer');
  await esperarOuExplodir(page, () => document.getElementById('autorModal').classList.contains('hidden'), 'o "Esquecer" fechar a folha');
  const historicoRedesenhado = await page.evaluate(() => (document.getElementById('filtersModal').classList.contains('hidden')
    ? document.getElementById('historyBody').textContent.trim().length : -1));
  checa(historicoRedesenhado > 0,
    'sair/DOM: CONTROLE — o "Esquecer" da folha não redesenhou o painel do Histórico escondido (o caso que o "Sair" tem de limpar não aconteceu)',
    String(historicoRedesenhado));
  // A FOTO QUE AINDA CHEGAVA no "Sair" (R8-1-04, auditoria de 2026-10-03). A
  // limpeza da lista de recursos do navegador deixava de fora o download no ar:
  // ele terminava depois, a entrada voltava, e a foto do pedido de terceiro ia no
  // relatório do modo dev de quem usasse a página depois. Uma foto de pedido sai
  // pelo aquecimento do app (o mesmo caminho do próximo card) e a resposta dela é
  // SEGURADA até depois do "Sair".
  let fotoLentaChegou = null;
  const fotoLentaPedida = new Promise((ok) => { fotoLentaChegou = ok; });
  await ctx.route('**/thumb700_LENTA_PRIVSAIR.png', async (r) => {
    fotoLentaChegou();
    await dormir(2500);
    await r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }).catch(() => {});
  });
  await page.evaluate((u) => aquecer(u), 'https://venue-image.waze.com/thumbs/thumb700_LENTA_PRIVSAIR.png');
  const fotoNoAr = await Promise.race([fotoLentaPedida.then(() => true), dormir(5000).then(() => false)]);
  checa(fotoNoAr, 'sair/recursos: PRÉ-CONDIÇÃO — a foto lenta nem foi pedida antes do "Sair"');
  // O "Sair", pela Ajuda.
  await tocar('#helpBtn');
  await esperarOuExplodir(page, () => !document.getElementById('helpModal').classList.contains('hidden'), 'a Ajuda abrir');
  await tocar('#logoutBtn');
  await esperarOuExplodir(page, () => !document.getElementById('logoutModal').classList.contains('hidden'), 'o diálogo do "Sair" abrir');
  await tocar('#confirmLogout');
  await esperarOuExplodir(page, () => !document.getElementById('authScreen').classList.contains('hidden') && !AppState.authenticated,
    'a tela de entrada depois do "Sair"');
  const depoisDoSair = await varrer();
  checa(depoisDoSair.length === 0, 'sair/DOM: depois do "Sair", o DOM da tela de entrada guarda dado de terceiro', JSON.stringify(depoisDoSair));
  const historicoDepoisDoSair = await page.evaluate(() => document.getElementById('historyBody').innerHTML.length);
  checa(historicoDepoisDoSair === 0,
    'sair/DOM: depois do "Sair", o painel do Histórico (redesenhado com os Filtros fechados) seguiu no DOM', String(historicoDepoisDoSair));
  // A foto termina DEPOIS do "Sair" e volta à lista CRUA do navegador — o CONTROLE
  // de que o caso aconteceu; o relatório do modo dev não pode levá-la.
  const fotoVoltou = await esperarNaPagina(page,
    () => performance.getEntriesByType('resource').some((e) => e.name.includes('thumb700_LENTA_PRIVSAIR')), 10000);
  checa(fotoVoltou.ok, 'sair/recursos: CONTROLE — a foto que terminou depois do "Sair" não voltou à lista crua (a medida não enxerga o caso)');
  const noRelatorio = await page.evaluate(async () => {
    AppState.devMode = { unlocked: true, active: true };
    try {
      const d = await diagCorpo();
      return (d.recursos || []).map((r) => r.url).filter((u) => u.includes('PRIVSAIR'));
    } finally { AppState.devMode = { unlocked: false, active: false }; }
  });
  checa(noRelatorio.length === 0, 'sair/recursos: a foto de terceiro que ainda chegava no "Sair" foi no relatório do modo dev',
    JSON.stringify(noRelatorio));
  // O "Acesso restrito" do login por cookies: o perfil recusado aparece no
  // diálogo (CONTROLE) e sai dele quando ele fecha (pelo voltar do aparelho).
  // (Uma linha do Waze basta: quem recusa é o servidor de mentira.)
  await page.evaluate(() => authenticateWithCookies('.waze.com\tTRUE\t/\tTRUE\t9999999999\t_web_session\tZ'));
  await esperarOuExplodir(page, () => !document.getElementById('accessDeniedModal').classList.contains('hidden'), 'o "Acesso restrito" abrir');
  const comNegado = await varrer();
  await page.evaluate(() => history.back());
  await esperarOuExplodir(page, () => document.getElementById('accessDeniedModal').classList.contains('hidden'), 'o voltar fechar o diálogo');
  const depoisDoNegado = await varrer();
  checa(comNegado.includes('accessDeniedProfile'), 'sair/DOM: CONTROLE — o perfil recusado não apareceu no diálogo', JSON.stringify(comNegado));
  checa(depoisDoNegado.length === 0, 'sair/DOM: o perfil de quem o portão recusou ficou no DOM do diálogo fechado', JSON.stringify(depoisDoNegado));
  checa(erros.length === 0, 'sair/DOM: erro de JS', erros[0]);
  await ctx.close();
}

// ── MAPA + SERVICE WORKER: mora em `tools/smoke-offline.mjs` ──────────────
//
// Este bloco nasceu aqui e MUDOU DE CASA, de propósito. O offline precisa do
// service worker LIGADO, e este arquivo é de LAYOUT: são 47 contextos com
// `serviceWorkers: 'block'`, porque SW no meio de medição de pixel só
// atrapalha. Misturar as duas coisas deixou o bloco medindo com `js/min/`
// regerado no meio da execução — falha de instrumento, não do app.
//
// O arquivo dedicado cobre o mesmo e mais: mapa intacto com o toggle
// DESLIGADO (o defeito que sumiu com o mapa de todo mundo), a varredura
// enchendo com a CSP real, o tile voltando do cache sem tocar a rede, a
// abertura offline, o card de foto travado e o "esquecer" parando o download
// em voo. E ele foi SABOTADO com os dois defeitos de produção: os dois
// reprovam. Roda no CI por `npm run test:offline`.

await browser.close();
servidor.kill();
checa(presencaComSessaoFalsa.length === 0,
  `a lista da presença levou 401 DE VERDADE com a sessão falsa em ${presencaComSessaoFalsa.length} contexto(s) — o bloco mediu uma sessão que ia cair; responda a presença com \`presencaViva(ctx)\``,
  [...new Set(presencaComSessaoFalsa)].join(', '));
if (resumoDosPulos(MOTOR)) console.log(resumoDosPulos(MOTOR));

if (falhas) {
  console.log(`\n✗ smoke de browser: ${falhas} falha(s)`);
  process.exit(1);
}


console.log(`✓ smoke de browser: ${APARELHOS.length} aparelhos × ${LINGUAS.length} idiomas × ${Object.keys(CARDS).length} tipos de card`
  + `, + ${FIXTURES_PAISES.length} pedidos REAIS de ${new Set(FIXTURES_PAISES.map((f) => f._pais)).size} países × ${APARELHOS_PAISES.length} aparelhos × ${LINGUAS.length} idiomas`
  + `, + ${FORMATOS_FOTO.length} formatos de foto × ${APARELHOS_PAISES.length} aparelhos`
  + `, + legibilidade do mapa × ${LINGUAS.length} idiomas, + queda dos tiles (404/403, no card e no ampliado arrastado, sem pedir de novo o tile que falhou)`
  + `, + mapa ampliado (abrir, arrastar buscando tile novo, zoom, recentrar, as quatro setas andando, Esc e ✕)`
  + `, + escala do mapa medindo o que diz (card e ampliado, pela barra DESENHADA contra o movimento que o core mediu, e o rótulo cabendo no traço do z8 ao z4)`
  + `, + convite de instalar em 3 telas apertadas × ${LINGUAS.length} idiomas`
  + `, + convite no iPhone FORA do Safari em 3 telas × ${LINGUAS.length} idiomas, lado a lado com o do Safari (o 1º passo pela CHAVE do navegador, o texto do dicionário do idioma, sem estourar nem partir palavra, e cabendo onde o do Safari cabe; antes do iOS 16.4 o convite some, com o CONTROLE do Safari antigo; e o Safari reconhecido pela POSITIVA: o Opera, o DuckDuckGo e o app do Google com o passo do menu do navegador, e nenhum convite no Opera de um iOS antigo nem dentro do Facebook, do Instagram e do Snapchat)`
  + `, + lixeira do lightbox (portão L6+AM, alvo, foto pendente e a janela de Desfazer)`
  + `, + aprovar foto nova (exclusividade com a lixeira, portão com staff, envio só ao fim da janela e approve=true, e a pílula do nome travada e esmaecida na janela, com o CONTROLE viva antes e depois)`
  + `, + foto que NÃO carregou (sem aprovar nem lixeira, nem pelo clique no botão escondido, com o CONTROLE da foto que carrega)`
  + `, + sessão morta leva pra tela de entrar e oscilação de rede NÃO derruba`
  + `, + falha de busca NUNCA vira "Tudo limpo!" (401 com alarme falso, medido pela REDE)`
  + `, + tile desenhado no tamanho pedido (card e ampliado, com stub DIFERENTE por x/y)`
  + `, + aquecimento dos próximos cards medido pela REDE (profundidade, largura e prioridade)`
  + `, + primeira execução ("Como funciona" uma vez só, scrim cobrindo o card, Esc sem sair do app, e o "Já instalei" que recarrega)`
  + `, + modo treino × ${LINGUAS.length} idiomas com a trava medida pela REDE (botão, tecla e gesto, com a janela do Desfazer vencida), e o fim do treino fechado pelos 4 caminhos (botão, Esc, voltar e fundo) devolvendo a fila real`
  + `, + o "Sair" do treino pelo TECLADO levando o foco ao ✕ do card real que volta (com o CONTROLE do mouse, que não move o foco)`
  + `, + o fim do treino (Enter no "Ir para a fila" e Esc), o "Quero treinar antes" e o "Praticar" pelo TECLADO levando o foco ao ✕ do card que entra, e o "Entendi" e o Esc do "Como funciona" ao ✕ do card na tela — também no que abre sozinho (com os CONTROLES do mouse, que não move o foco pro card)`
  + `, + layout do treino em ${APARELHOS_TREINO.length} aparelhos × ${LINGUAS.length} idiomas (sobreposição, dobra, alvo e alcance, e o exemplo sintético SEM o ↗ na tela)`
  + `, + treino com fila REAL × ${LINGUAS.length} idiomas: foto, lote, folha do autor e card mortos, com contraprova de que a lixeira e as linhas da folha EXISTEM fora do treino, e o ↗ do clone na tela com o lugar dele`
  + `, + controles do cabeçalho CLICADOS (atualizar, filtros, tema, ajuda) exigindo zero erro de JS`
  + `, + ponto no ícone (ponto e nunca número, limpa ao zerar e ao sair, sem pedir permissão, e sem quebrar onde não há suporte)`
  + `, + aviso de sessão vencendo em 2 aparelhos × ${LINGUAS.length} idiomas (9 prazos contados pela DATA com o relógio parado às 20h — "amanhã" com 20 h de prazo —, contraste composto, não vira alvo de toque e some no "Sair")`
  + `, + treino em 5 tamanhos de fila (contador = cards, teto de 30, piso de 3, todo card inerte e variedade na frente)`
  + `, + foto de perfil medida pela REDE: não sai antes da tela pronta, mas SAI depois (com fila e com fila vazia)`
  + `, + CSP sem violação e o tema inline EXECUTANDO nos dois esquemas (hash defasado bloqueia em silêncio)`
  + `, + tema trocado pelo BOTÃO pintando o mesmo que a RECARGA (${temaMedidas} medidas: fundo do html e do body e a barra que vale, nos 2 sistemas, ida e volta; sentinela do diagnóstico calada no tema certo e ALERTANDO no estado quebrado recriado, com o CONTROLE de que ele pinta escuro)`
  + `, + pareamento com o QR VENCIDO (sem a instrução da câmera nem o "Sem câmera?", com o CONTROLE do QR valendo; o código curto pedido antes valendo até o prazo DELE, sem o "Código expirado" em cima, e a instrução dele saindo quando ele vence; e o foco do TECLADO nos botões que saem de cena — no "Fechar" quando o QR vence, no "Copiar link" quando o código chega —, com o CONTROLE do motor largando o foco no <body> e o do mouse, que não move o foco)`
  + `, + tira de miniaturas do lightbox em 3 aparelhos apertados (entra no layout sem cobrir foto nem controle, alvo 44px, e reusando a URL já em cache)`
  + `, + idade da foto na pílula (relativo até 1 ano, ano depois, plural certo, e some quando não há data)`
  + `, + DUPLICATE em 2 aparelhos apertados × ${LINGUAS.length} idiomas (nomeia o alvo, marca no mapa, volta à forma isolada sem nome, e nome longo sem empurrar a barra nem ligar a rede de segurança — teto de duas linhas com o nome inteiro no title, e o CONTROLE sem teto ligando a rede no Fold)`
  + `, + realce do miolo em 2 aparelhos × 2 temas (sobrevive ao line-clamp, contraste no pixel composto, cala no óbvio e guarda o valor inteiro no title)`
  + `, + renomeando: ação de foto some (e VOLTA) e as setas são do cursor, com controle dos dois lados`
  + `, + renomeando: o passo pra trás (fundo, arraste pra baixo, Esc e ↓ fora do campo) só sai da edição, com o CONTROLE sem edição fechando a foto`
  + `, + a roda do mouse e o trackpad (no mapa um nível por DENTE acumulado, na foto proporcional ao delta, e a rolagem horizontal fora do zoom, com o CONTROLE do dente) e o duplo toque do mapa com tremor (com o CONTROLE do arraste)`
  + `, + o foco nas camadas de ampliar (fechar a foto e o mapa por Esc/↓/✕ devolve à foto/mapa do card, sair da edição devolve à pílula, aprovar e salvar mantêm na camada, com e sem Desfazer, e o ✨/🚩 e a miniatura com NOME, com o CONTROLE do Filtros)`
  + `, + faixa do carrossel não rouba o toque do mapa (2 aparelhos, com o mapa EXIGIDO na tela)`
  + `, + abas de Filtros em 2 aparelhos × ${LINGUAS.length} idiomas (alvo 44px E rótulo sem corte)`
  + `, + Ajuda em 2 aparelhos × ${LINGUAS.length} idiomas (toda seção com o texto do MESMO tamanho medido na tela, dois-pontos no título, "Quem está no app" logo depois de "Como usar", com contraprova da lista de antes)`
  + `, + Resumo do mês em 2 aparelhos × ${LINGUAS.length} idiomas (1080×1350 de verdade, número e QR desenhados, botões na tela, download nomeado, limpeza no Esc)`
  + `, + foto de perfil em 2 aparelhos (host fora da CSP, 404, redesenho e o CONTROLE da foto boa)`
  + `, + Perto de mim em 2 aparelhos × 2 idiomas (as 3 opções, ordem ponta a ponta, GPS concedido E negado pelo browser — o negado com a dica da PERMISSÃO —, o "Aplicar" esperando a posição e levando a do modal só ao aplicar, a dica de "sem posição" cabendo em 4 idiomas, a troca de idioma com os Filtros abertos alcançando seletores e dica, os Filtros abertos antes do perfil guardando ordem e área e se redesenhando quando ele chega, e o perfil sem endereço; no Chromium, a permissão concedida SEM posição de verdade)`
  + `, + renomear pelo lightbox em 3 aparelhos (portão L6+AM com treino barrado, 3 alturas de teclado sem cobrir campo nem a placa da fachada, a foto em pé com a tira de miniaturas parando antes do campo, e envio medido pela REDE com Desfazer impedindo)`
  + `, + teto da lista de autores (10 exatos NÃO geram botão, o rótulo traz quantos faltam, altura constante de 11 a 100, e o Esc devolve à lista curta)`
  + `, + FAB do modo dev com TOQUE de verdade em 3 celulares (nasce livre em 5 camadas medidas por hit-test; o gesto do owner — segura, o botão avisa que pegou, acompanha o dedo em zigue-zague sem se descolar, e toque devagar segue sendo toque)`
  + `, + teclado virtual com visualViewport FALSO (viewport mentindo 388px sem foco não achata modal, campo focado ainda cede altura, e o inset sai no blur)`
  + `, + Street View no lightbox do mapa (alvo 44px por hit-test, zero pontos roubados de escala/legenda/✕/zoom, viewpoint em [lat,lon], e o link ACOMPANHANDO arrastar e recentrar)`
  + `, + o mapa ampliado no TOQUE de verdade, no ${MOTOR} (o Street View ABRE a aba e o duplo toque aproxima UM nível — no iPhone nenhum dos dois funcionava —, com o CONTROLE do ↗ do card abrindo e de um toque só não aproximando)`
  + `, + pilha do próximo pedido em 2 aparelhos × 2 temas × ${LINGUAS.length} idiomas (dedo em grade 3×3 nunca chega ao card de fundo, Tab REAL nunca pousando nele, com contraprova sem inert, inert/aria/ponteiro, véu computado, tirar o véu MUDANDO pixel, e ZERO ouvinte no card de fundo por clique programático com controle na frente, e o mapa do fundo DESENHADO pro mesmo tamanho do da frente — a promessa que o relato do iPhone mostrou quebrada)`
  + `, + fila de saída offline (modo avião com rota ABORTADA, placar que não reverte, fila sobrevivendo a matar o app, esvaziamento com ritmo medido e UMA requisição por ação, gatilho da ABERTURA drenando sem nenhum evento online, rede voltando em DOIS TEMPOS sem engolir o 2º evento online (janela alargada de propósito, com controle de que o esvaziamento está mesmo no ar), resposta que CHEGA drenando a fila SEM nenhum evento online novo (o relato do iPhone, com controle de que ela não drenou antes), app MORTO no meio do voo reenviando sem contar duas vezes, pouso que falha DE VERDADE desfazendo o placar GRAVADO, e CONTROLE de erro que não é rede)`
  + `, + carimbo de nascimento escrito na carga (normal E pelo código de pareamento, com o ramo EXIGIDO, sem reescrever no reload, e o diário como CONTROLE)`
  + `, + os avisos de UMA vez só saem onde a pessoa os vê (a consequência do 1º ✕ com os Filtros abertos, o desbloqueio do Desfazer com a página no fundo e a dica com a Ajuda aberta no SE esperam, sem marcar, e saem inteiros no fechamento e na volta — grade 3×3 de hit-test, com o CONTROLE sem camada e o da grade vendo o banner coberto; o que o TREINO segurou sai no "Sair" da faixa e no ↻, o que estava na tela quando ele abriu sai dele e volta no fim, com o CONTROLE do dispensado que não volta; e o interruptor do Desfazer travando com as Preferências abertas quando o "Desfazer" devolve o placar abaixo da cota)`
  + `, + o ponto de conquista LEVA ao que destravou (clique REAL no botão, aba certa já no 1º quadro com rede de 1,4s, marcas vivas, pulso por alvo, alvo visível, patente sem célula, reduced-motion sem pulso, CONTROLE sem novidade e a 2ª abertura voltando a Filtros)`
  + `, + entrada do card SEM efeito (zero movimento, zero mudança de tamanho e opacidade cheia medidos no DOM, card de fundo visível o tempo todo, em movimento normal e reduced-motion, com CONTRAPROVA que injeta o fade e o esconderijo de volta)`
  + `, + Desfazer até o FIM (devolve o pedido, tira o banner e REABILITA os botões — o defeito de #215 que rodou em produção)`
  + `, + presença no WME de carona medida pela REDE (posição do card NA TELA em [lat,lon] com id e país, visibilidade ligando na 1ª ação, freio de 30 s, desligar escondendo no WME na hora, religar na ação seguinte, e o invisível do WME NÃO desligando o app: a ação seguinte religa de carona)`
  + `, + gestos e teclas que NÃO decidem (pinça e puxão pra baixo por toque de verdade; arraste de mouse pela foto e pelo mapa sem prender o card nem abrir camada; a aprovação pousando no meio da saída sem o ✓, a seta ou o arraste agirem no pedido seguinte; setas rolando a lista de mudanças; z e Tab desfazendo a exclusão de foto — cada um com o CONTROLE do gesto que decide)`
  + `, + o card da auditoria de 2026-09-29 (a foto em decisão falhando no meio da saída pelo ✕ e o card VOLTANDO com o aviso, com o CONTROLE da foto que chega; Enter no ✕ ↑ ✓ e no Desfazer levando o foco ao botão equivalente, com e sem a janela, e o CONTROLE do mouse que não move foco; Enter no "Ver +N" e na barra do foco sem largar o foco no <body>; a foto que falha depois de o foco pousar no ✕ levando o foco ao ↑, com o CONTROLE da foto que chega; a barra do foco no autor voltando à ordem normal sem trocar o card; a barra SUMINDO quando a outra aba decide a série inteira, com o foco do teclado indo ao ✕ do card, com os CONTROLES da série que segue viva e do mouse; a seta e o gesto decidindo o último pedido do autor com o foco na barra, e o foco indo ao "Ver +N" do card novo — ou, no fim da fila, a barra saindo de cima do "Tudo limpo!" com o foco no "Verificar novamente", e o Desfazer do último devolvendo a barra com o foco no ✕ —, com os CONTROLES da série que segue e do mouse; e o card travado pelo lote respondendo ao toque no botão disabled, à seta e ao arraste, um aviso por vez, saindo quando a trava acaba, com o CONTROLE da janela do Desfazer calada)`
  + `, + mapa e pílula que não saem da caixa (girar o aparelho, o ponto longe que não derruba os que cabem, o ampliado de 82 km com os dois pontos na tela, o de 2.510 km AVISANDO como o card e sem prometer na legenda o marcador fora da tela, e a pílula do nome em edição no Fold)`
  + `, + duas abas no MESMO navegador (placar e preferências relidos do aparelho, o selo do ↑ e a estrela seguindo a outra aba, a queda NÃO encerrando a outra, o "Sair" encerrando a outra com a camada aberta fechada, o aviso dizendo por quê e ZERO escrita no aparelho — com o CONTROLE da aba surda reprovando como o app de antes — e a queda com o token VELHO numa aba sem apagar o NOVO da outra, que recarrega logada, com o CONTROLE da sessão guardada caindo como sempre — e OUTRA conta entrando numa aba tirando a da conta anterior, sem tocar no aparelho e destruindo a sessão dela no servidor, com o CONTROLE da MESMA conta entrando de novo — e a decisão NO AR numa aba não saindo de novo pela outra, nem contando duas vezes no Histórico, com o CONTROLE da marca da aba tirada mandando de novo — e o que uma aba DECIDIU saindo da fila da outra, com o "Restam" e o card de fundo, e o ✕ no card da tela que ela já decidiu sem sair pro Waze nem contar de novo, dizendo por quê, com o CONTROLE do app de antes mandando de novo — e o que POUSA fora da fila de saída (o "Marcar todos", a recusa automática e a aprovação de foto) chegando à outra aba pelo canal do pouso, com o CONTROLE do canal fechado mandando de novo)`
  + `, + o "Sair" sem dado de TERCEIRO no DOM (a lista de autores, a folha do autor, a foto ampliada e o "Acesso restrito", fechados pelo Esc, pelo fundo, pelo ✕ e pelo voltar, varridos por uma marca em texto e atributos — com o CONTROLE da varredura vendo cada um aberto —, o painel do Histórico fechado e o redesenhado pela folha do autor, e a foto que ainda chegava fora do relatório do modo dev, com o CONTROLE dela voltando à lista crua)`
  + `, + (o mapa com service worker mora em npm run test:offline — este arquivo é de layout e bloqueia SW de propósito)`
  + `, + Patentes e Conquistas em 3 aparelhos × 2 temas × ${LINGUAS.length} idiomas (o aviso NÃO cobre o placar nem solta confete, o selo acende e apaga ao abrir a aba, contagem CRUA no placar e no cartão em 4 idiomas, colunas iguais, palavra partida por Range, sobreposição por hit-test, contraste do trancado nos dois temas, portão 16×14 com contraprova, e a primeira passada SILENCIOSA)`);
