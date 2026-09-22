// "Disponível offline" — o trabalho sobrevive à sombra de sinal.
//
// Os guards aqui cobrem o que NENHUM outro teste enxerga, e cada um nasceu de
// uma medição desta PR:
//
//  · o SUFIXO da foto é CONTRATO. Card, lightbox e aquecimento têm que usar a
//    MESMA URL. Se um usar a crua, ele pede um endereço que ninguém aqueceu e
//    a foto some offline — sem erro no console, sem nada na tela.
//  · a RETOMADA vale metade do recurso. Medido numa estrada simulada (20s de
//    sinal / 40s de buraco): com retomada, 160 cards e ZERO perdidos; sem ela,
//    77 cards e 404 itens perdidos PARA SEMPRE.
//  · a JANELA SERVIDA só pode avançar quando a varredura TERMINA. Virá-la antes
//    faz o card pedir um sufixo que ninguém aqueceu, com a cópia boa parada no
//    cache a um sufixo de distância.
//  · o cache dos tiles NÃO pode entrar na faxina do `activate`: o deploy
//    apagaria o mapa provisionado, e o editor descobriria na estrada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const MIN = readFileSync(new URL('../js/min/app.js', import.meta.url), 'utf8');
const SW = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');

// Guard que lê fonte se amarra em CÓDIGO, nunca em comentário: o comentário
// cita o nome justamente porque ele é importante ali (gotcha #67).
const semComentarios = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const APP_SEM = semComentarios(APP);
const SW_SEM = semComentarios(SW);

function fatiar(nome) {
  const marca = APP_SEM.indexOf('function ' + nome + '(');
  assert.ok(marca >= 0, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', marca);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  i = APP_SEM.indexOf('{', i);
  let prof = 0, fim = APP_SEM.length;
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(marca, fim);
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — instrumento quebrado`);
  return corpo;
}

test('o toggle é opt-IN ESTRITO: quem nunca marcou não paga nada', () => {
  assert.match(APP_SEM, /offlineDisponivel = parsed\.offlineDisponivel === true/,
    'a carga tem que ser `=== true`; `!== false` ligaria o recurso pra todo mundo');
  assert.match(fatiar('offlineLigado'), /offlineDisponivel === true/);
  // e o HTML nasce SEM `checked`
  const linha = HTML.slice(HTML.indexOf('id="prefOfflineDisponivel"') - 200,
                           HTML.indexOf('id="prefOfflineDisponivel"') + 80);
  assert.ok(!/id="prefOfflineDisponivel"[^>]*checked/.test(linha),
    'a linha do offline não pode nascer marcada');
});

test('urlDaFoto é FONTE ÚNICA: os três consumidores passam por ela', () => {
  // card, lightbox e aquecimento
  assert.match(APP_SEM, /img\.src = urlDaFoto\(s\.foto\)/, 'o card do carrossel');
  assert.match(APP_SEM, /img\.src = urlDaFoto\(this\.urls\[this\.idx\]\)/, 'o lightbox');
  assert.match(APP_SEM, /aquecer\(urlDaFoto\(/, 'o aquecimento do primeiro slide');
  // e NINGUÉM atribui .src direto de imageUrls sem passar por ela
  const cruas = APP_SEM.match(/\.src = [^;\n]*imageUrls[^;\n]*/g) || [];
  for (const c of cruas) {
    assert.match(c, /urlDaFoto\(/, `atribuição crua de .src a partir de imageUrls: ${c}`);
  }
});

test('urlDaFoto devolve a URL INTACTA com o toggle desligado', () => {
  const corpo = fatiar('urlDaFoto');
  assert.match(corpo, /!offlineLigado\(\)[^;]*return u/,
    'sem o toggle a URL tem que sair intacta — senão quem não marcou perde o cache dele');
  assert.match(corpo, /offlineJanelaServida === null/,
    'sem janela servida também sai intacta: sufixo que ninguém aqueceu é foto que some');
});

test('a varredura DEVOLVE pro fim o item que falhou (vale metade do recurso)', () => {
  const corpo = fatiar('offlineVarrer');
  assert.match(corpo, /pend\.push\(it\)/,
    'item que falha tem que voltar pra fila; sem isso um buraco de sinal o perde pra sempre');
  assert.match(corpo, /pend\.shift\(\)/, 'e sai pela frente: ordem de fila');
  assert.match(corpo, /falhas > total \* 2/, 'com teto, senão rede morta vira laço eterno');
});

test('a janela servida só avança quando a varredura TERMINA', () => {
  const corpo = fatiar('offlineVarrer');
  const i = corpo.indexOf('offlineJanelaServida = janela');
  assert.ok(i > 0, 'a janela precisa ser atribuída na varredura');
  const antes = corpo.slice(Math.max(0, i - 160), i);
  assert.match(antes, /if \(!pend\.length\)/,
    'a atribuição tem que estar COLADA na condição de fila vazia');
});

test('`onLine` é usado de UMA MÃO só: só o false muda comportamento', () => {
  const corpo = fatiar('offlineVarrer');
  assert.match(corpo, /navigator\.onLine === false/,
    '`true` não prova rede (portal cativo mente) — só o false pode barrar');
  assert.ok(!/navigator\.onLine === true/.test(corpo),
    'nada pode depender de onLine ser true');
});

test('a varredura dorme quando ninguém está usando a app', () => {
  assert.match(fatiar('offlineVarrer'), /OFFLINE_OCIOSO_MS/,
    'sem isso a app cobra dados de quem a deixou aberta no bolso');
  assert.match(APP_SEM, /function offlineMarcarGesto/);
});

test('o ciclo é de 20 minutos, e o doc não pode divergir dele', () => {
  const m = APP_SEM.match(/OFFLINE_CICLO_MS = (\d+) \* 60 \* 1000/);
  assert.ok(m, 'a constante do ciclo sumiu');
  assert.equal(m[1], '20', 'o ciclo escolhido pelo owner foi 20 min');
});

test('o cache dos tiles é ISENTO da faxina do deploy', () => {
  assert.match(SW_SEM, /cacheName !== CACHE_NAME && cacheName !== TILES_CACHE/,
    'sem a isenção, cada deploy apaga o mapa que o editor provisionou');
  assert.match(SW_SEM, /const TILES_CACHE = 'waze-places-tiles'/);
  // e o nome tem que bater com o do app.js — são dois arquivos, um contrato
  const noApp = APP_SEM.match(/OFFLINE_TILES_CACHE = '([^']+)'/);
  const noSw = SW_SEM.match(/TILES_CACHE = '([^']+)'/);
  assert.ok(noApp && noSw, 'faltou uma das constantes');
  assert.equal(noApp[1], noSw[1], 'o nome do cache diverge entre app.js e service-worker.js');
});

test('a exceção do SW é ESTREITA: só o tile, não todo domínio externo', () => {
  const i = SW_SEM.indexOf('url.origin !== self.location.origin');
  const bloco = SW_SEM.slice(i, i + 700);
  assert.match(bloco, /-tiles\\\/live\\\/base\\\//,
    'a exceção tem que casar o caminho do tile, não qualquer coisa de fora');
  assert.match(bloco, /return;/, 'e o resto do cross-origin continua ignorado');
});

test('sair apaga a fila guardada e os tiles (dado de terceiro)', () => {
  const corpo = fatiar('handleLogout');
  assert.match(corpo, /offlineEsquecer\(\)/, '"sair é sair de tudo" não abre exceção');
  const esq = fatiar('offlineEsquecer');
  assert.match(esq, /deleteDatabase/);
  assert.match(esq, /caches\.delete\(OFFLINE_TILES_CACHE\)/);
  assert.match(esq, /offlineJanelaServida = null/, 'a janela também some');
});

test('o card de FOTO sem foto trava ✕ e ✓ e deixa o ↑ vivo', () => {
  const corpo = fatiar('marcarCardSemFoto');
  assert.match(corpo, /NEW_PHOTO|FLAGGED_PHOTO/, 'só vale pros dois tipos em que a foto decide');
  assert.match(corpo, /navigator\.onLine !== false/, 'com rede não há por que avisar nada');
  assert.match(corpo, /card-btn-reject/); assert.match(corpo, /card-btn-read/);
  assert.ok(!/card-btn-skip/.test(corpo), 'o ↑ tem que continuar vivo: é a única ação verdadeira');
  assert.match(corpo, /disabled = true/); assert.match(corpo, /acoes-travadas/,
    'disabled sem esmaecer é botão morto com cara de vivo');
});

test('as 13 chaves novas existem nas QUATRO línguas', () => {
  const chaves = ['prefs.offline.label','prefs.offline.desc','prefs.offline.enchendo',
    'prefs.offline.prontoA','prefs.offline.prontoAPlural','prefs.offline.prontoB',
    'prefs.offline.esperaA','prefs.offline.esperaAPlural','prefs.offline.esperaB',
    'prefs.offline.vazioA','prefs.offline.vazioB','card.semFoto.titulo','card.semFoto.desc'];
  for (const k of chaves) {
    const n = (I18N.match(new RegExp("'" + k.replace(/\./g, '\\.') + "':", 'g')) || []).length;
    assert.equal(n, 4, `${k} aparece ${n}× — tem que ser 4 (pt/en/es/fr)`);
  }
});

test('o plural tem chave própria: "1 pedidos" não sai em língua nenhuma', () => {
  const corpo = fatiar('atualizarLinhaDoOffline');
  assert.match(corpo, /n === 1 \? 'prefs\.offline\.prontoA' : 'prefs\.offline\.prontoAPlural'/);
  assert.match(corpo, /n === 1 \? 'prefs\.offline\.esperaA' : 'prefs\.offline\.esperaAPlural'/);
});

test('js/min/ está em dia com o fonte (gotcha #22)', () => {
  // o minificador renomeia LOCAIS, então ancora em nome GLOBAL, que sobrevive
  for (const nome of ['offlineVarrer', 'urlDaFoto', 'offlineTentarAbrirSemRede', 'marcarCardSemFoto']) {
    assert.ok(MIN.includes(nome), `${nome} não está em js/min/app.js — falta rodar npm run js`);
  }
});

// ── O DEFEITO QUE FOI PRA PRODUÇÃO (v2026.09.21-08), e o guard que faltava ──
//
// A varredura baixava tile com `fetch(url)`, e a CSP escolhe a diretiva pelo
// DESTINO da requisição: `fetch` cru tem destino '' → `connect-src`; `<img>`
// tem destino 'image' → `img-src`. O `img-src` já permitia `https://*.waze.com`
// (a foto passava), o `connect-src` é NOMINAL e não tinha o host do tile —
// então TODO tile era bloqueado ANTES da rede, sem erro no console da app.
//
// Sintoma no aparelho do owner: "Preparando… 197 de 530" parado pra sempre.
// Os 197 eram as fotos; os tiles nunca entraram. REPRODUZIDO num servidor local
// com a mesma forma de CSP (fetch BLOQUEADO / <img> OK) e o conserto provado
// no mesmo instrumento. O cache `waze-places-tiles` do diagnóstico dele: ZERO.
//
// Nenhum teste de fonte enxergaria isto — CSP é comportamento de navegador. O
// guard abaixo cobre a REGRESSÃO; quem cobre a CLASSE é o bloco do smoke.
test('o host do tile está no connect-src das TRÊS cópias da CSP', () => {
  const MAPA = readFileSync(new URL('../js/mapa.js', import.meta.url), 'utf8');
  const HEADERS = readFileSync(new URL('../_headers', import.meta.url), 'utf8');
  const NODE = readFileSync(new URL('../server/node.mjs', import.meta.url), 'utf8');
  // o host sai do PRÓPRIO mapa.js: copiar a string aqui é como elas divergem
  const m = semComentarios(MAPA).match(/https:\/\/([a-z0-9.-]+)\/\$\{[^}]*\}-tiles/);
  assert.ok(m, 'não achei o host do tile no mapa.js — o guard cegou');
  const host = m[1];
  for (const [nome, cru] of [['_headers', HEADERS], ['index.src.html', HTML], ['server/node.mjs', NODE]]) {
    // TRÊS armadilhas numa linha só, e as três me pegaram escrevendo este guard:
    //  1. os três arquivos CITAM `connect-src` num comentário que explica por
    //     que ele é nominal — casar o nome solto lia a citação (gotcha #67);
    //  2. excluir o apóstrofo da classe parava o casamento no `'self'`, e o
    //     guard acusava arquivo que estava CERTO;
    //  3. e tirar comentário com `/\*…\*/` é pior ainda aqui: o próprio CSP
    //     tem `https://*.waze.com`, cujo `/*` abre um "bloco" que engole o
    //     resto do arquivo. O removedor de comentário virou o defeito.
    // A saída é ancorar na FORMA da diretiva: só a de verdade tem `'self'`.
    const cs = cru.match(/connect-src 'self'[^;"`]*/);
    assert.ok(cs, `${nome}: sem connect-src`);
    assert.ok(cs[0].includes(host),
      `${nome}: connect-src não permite ${host} — a varredura do offline não consegue`
      + ' baixar tile nenhum, e o bloqueio é ANTES da rede (sem erro visível)');
  }
});

test('a linha não fica presa em "Preparando…" quando a varredura desiste', () => {
  const corpo = fatiar('offlineVarrer');
  const i = corpo.indexOf('offlineVarrendo = false');
  assert.ok(i > 0, 'a bandeira precisa ser baixada no finally');
  const depois = corpo.slice(i, i + 220);
  assert.match(depois, /atualizarLinhaDoOffline\(/,
    'o redesenho tem que vir DEPOIS de baixar a bandeira; antes dela a linha'
    + ' mostra "Preparando…" de uma varredura que já acabou — e congela ali');
  // DOIS casos distintos, e a asserção precisa distinguir: a varredura que
  // termina com fila sobrando (o `else`) e a que morre de exceção (o `catch`).
  // Cobrar só a string casava com QUALQUER um dos dois, então tirar um deixava
  // o guard verde — ele foi sabotado, passou limpo, e virou isto.
  assert.match(corpo, /\}\s*else\s*\{[^}]*offlineUltimoResultado = 'parcial'/,
    'a varredura que acaba com fila sobrando tem que se declarar parcial');
  assert.match(corpo, /catch \([^)]*\) \{[^}]*offlineUltimoResultado = 'parcial'/,
    'a que morre de exceção também — senão a linha mentiria "Pronto" depois de um erro');
});

test('o estado parcial existe nas quatro línguas e não diz "Pronto"', () => {
  for (const k of ['prefs.offline.parcialA', 'prefs.offline.parcialB']) {
    const n = (I18N.match(new RegExp("'" + k.replace(/\./g, '\\.') + "':", 'g')) || []).length;
    assert.equal(n, 4, `${k} aparece ${n}× — tem que ser 4`);
  }
  const corpo = fatiar('atualizarLinhaDoOffline');
  const iPar = corpo.indexOf("offlineUltimoResultado === 'parcial'");
  const iPronto = corpo.indexOf("prefs.offline.prontoA");
  assert.ok(iPar > 0 && iPronto > iPar,
    'o ramo do parcial tem que vir ANTES do de pronto, senão ele nunca é alcançado');
});

// ── O DEFEITO QUE QUEBROU O MAPA DE TODO MUNDO ────────────────────────────
//
// O SW passou a interceptar o tile e a responder `hit || fetch(...)`.
// `respondWith` é uma PROMESSA DE RESPONDER: com o fetch falhando (ali, barrado
// pela CSP), a imagem falhava — enquanto SEM o service worker o navegador a
// teria carregado normalmente. O mapa sumiu inclusive pra quem NUNCA ligou o
// offline, que é o oposto do que o recurso promete.
//
// A invariante: a interceptação é ESTRITAMENTE ADITIVA. Sem entrada no cache,
// o SW não responde e o navegador faz o que sempre fez.
test('o SW só responde pelo tile que JÁ está guardado (nunca promete rede)', () => {
  const i = SW_SEM.indexOf('url.origin !== self.location.origin');
  const bloco = SW_SEM.slice(i, i + 900);
  assert.match(bloco, /tilesGuardados\.has\(/,
    'a decisão de responder tem que consultar a lista SÍNCRONA do que está guardado');
  // e o respondWith tem que estar DENTRO desse if, não antes dele
  const iHas = bloco.indexOf('tilesGuardados.has(');
  const iResp = bloco.indexOf('event.respondWith');
  assert.ok(iHas > 0 && iResp > iHas,
    'o `respondWith` tem que vir DEPOIS da checagem — senão o SW promete responder'
    + ' por tile que ele não tem, e a imagem quebra quando a rede falha');
});

test('a lista de tiles guardados é hidratada e se mantém viva', () => {
  assert.match(SW_SEM, /async function hidratarTiles/);
  assert.match(SW_SEM, /hidratarTiles\(\)[\s\S]{0,60}clients\.claim/,
    'tem que hidratar no activate, senão o SW acorda sem saber o que tem');
  assert.match(SW_SEM, /TILES_GUARDADOS[\s\S]{0,140}hidratarTiles\(\)/,
    'e re-hidratar quando a app avisa, senão só saberia no próximo activate');
  assert.match(APP_SEM, /postMessage\(\{ type: 'TILES_GUARDADOS' \}\)/,
    'a app precisa avisar o SW depois de guardar');
});

// ── O BURACO ESTRUTURAL: nenhum teste ligava o service worker ─────────────
//
// Os DOIS defeitos de produção passaram pela mesma razão: o smoke tinha 47
// contextos com `serviceWorkers: 'block'` e ZERO com 'allow'. O SW nunca foi
// exercitado, então quebrá-lo não reprovava nada.
//
// Este guard é META de propósito: ele não testa a app, testa se a COBERTURA
// existe. Sem ele, o próximo refactor do smoke pode remover a única cobertura
// de SW e ninguém perceberia — que é exatamente como o buraco nasceu.
test('existe cobertura de service worker E ela roda no CI', () => {
  const SMOKE = readFileSync(new URL('../tools/smoke-offline.mjs', import.meta.url), 'utf8');
  const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const CI = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

  assert.match(SMOKE, /serviceWorkers:\s*'allow'/,
    'o smoke do offline tem que LIGAR o service worker — foi com ele bloqueado em'
    + ' 47 contextos e ligado em zero que o mapa quebrou pra todo mundo sem nada reprovar');
  assert.match(SMOKE, /-tiles\/live\/base/, 'e exercitar o TILE, que é o que o SW intercepta');
  // Ancorado na ESTRUTURA, não na grafia: o que importa é esperar o SW ASSUMIR
  // por SINAL POSITIVO (`navigator.serviceWorker.controller`) e por um poll do
  // lado do Node, nunca por relógio. A versão anterior deste guard casava a
  // string `controller !== null` e reprovou código certo quando a espera trocou
  // de forma — gotcha #67 dentro do guard escrito pra evitar o #62.
  assert.match(SMOKE, /esperarNaPagina\([\s\S]{0,80}?serviceWorker[\s\S]{0,40}?controller/,
    'a espera pelo SW ASSUMIR tem que ser sinal POSITIVO pollado do Node (gotcha #62)');
  // o caso que mais importa: o mapa com o offline DESLIGADO
  assert.match(SMOKE, /offline DESLIGADO/,
    'tem que medir o mapa com o toggle desligado — quem não marcou nada foi quem mais sofreu');

  // O que o editor RECLAMOU foi "o mapa parou de carregar", e o que responde a
  // isso não é uma <img> solta: é o MAPINHA QUE A APP DESENHA. O smoke mede os
  // dois lugares em que o tile aparece, e carrega a CONTRAPROVA — sem ela,
  // "desenhou" passaria por vácuo no dia em que o seletor mudar de nome, porque
  // a asserção é `ok === n` e 0 === 0 é verdade (gotcha #28).
  assert.match(SMOKE, /card-map-tiles img/,
    'o smoke não mede o mapinha DO CARD — era ele que estava vazio no celular do editor');
  assert.match(SMOKE, /mapaLbTiles/,
    'o smoke não mede o mapa AMPLIADO, o outro lugar em que o tile aparece');
  assert.match(SMOKE, /CONTRAPROVA/,
    'a medida do mapa precisa de um caso que vá a ZERO, senão ela passa por vácuo');

  // A ESTRADA é o teste de ACEITAÇÃO: o percurso que o recurso promete. As
  // outras seções medem peça por peça, e as peças podem estar todas certas com
  // o percurso quebrado — foi exatamente o que chegou aos testadores.
  assert.match(SMOKE, /A ESTRADA/,
    'sumiu a seção da ESTRADA — é ela que exercita o percurso inteiro (encher,'
    + ' modo avião, triar com foto e mapa do cache, e a rede voltando pra drenar)');
  assert.match(SMOKE, /setOffline\(true\)/,
    'modo avião de verdade é abort MAIS setOffline — só abort deixa navigator.onLine true');
  assert.match(SMOKE, /icons\/splash\/[a-z0-9-]+\.png/,
    'a foto da ESTRADA tem que vir de um arquivo REAL do servidor: route.fulfill'
    + ' NÃO popula o cache HTTP, e o cache é o mecanismo inteiro da foto offline');

  // O DEPLOY é o outro modo de o mapa sumir, e ele não dá sintoma até a estrada:
  // o `activate` apaga todo cache ≠ CACHE_NAME, e sem a isenção o mapa
  // provisionado ia junto a cada versão nova. O guard de fonte abaixo lê a
  // linha do `if`; o smoke faz a faxina RODAR e mede o que sobrou.
  assert.match(SMOKE, /DEPLOY N\u00c3O APAGA O MAPA/,
    'sumiu a se\u00e7\u00e3o do deploy — sem ela, a isen\u00e7\u00e3o do cache de tiles s\u00f3 existe no papel');
  assert.match(SMOKE, /service-worker\.js\?deploy=/,
    'o deploy precisa ser encenado por URL de script DIFERENTE no mesmo escopo:'
    + ' medido, o ctx.route n\u00e3o v\u00ea o script do SW e unregister+register na mesma URL n\u00e3o reinstala');
  assert.match(SMOKE, /waze-places-2020010101/,
    'sumiu a ISCA — sem um cache de vers\u00e3o anterior pra faxina levar, "o mapa'
    + ' sobreviveu" passa por v\u00e1cuo no dia em que a faxina parar de rodar');

  // Cobertura que não roda é cobertura que não existe.
  assert.ok(PKG.scripts && PKG.scripts['test:offline'],
    'falta o script `test:offline` no package.json');
  assert.match(CI, /npm run test:offline/,
    'o CI não roda o smoke do offline — sem isso ele vira arquivo morto no dia em'
    + ' que alguém esquecer de rodá-lo à mão, que é exatamente como o buraco nasceu');
});

// A ESPERA DO ESVAZIAMENTO É FONTE ÚNICA, e este guard existe porque a lição
// não pegou por estar escrita: o comentário dentro do `smoke-browser.mjs` já
// listava as armadilhas do `page.waitForFunction`, e eu as repeti todas ao
// escrever a seção da ESTRADA no smoke do offline — o CI reprovou com `fila:5`.
// Reimplementar a espera é como ela volta a ser feita errado.
test('a espera do esvaziamento é FONTE ÚNICA, nunca reimplementada num smoke', () => {
  const OFF = readFileSync(new URL('../tools/smoke-offline.mjs', import.meta.url), 'utf8');
  const BROW = readFileSync(new URL('../tools/smoke-browser.mjs', import.meta.url), 'utf8');
  const MOD = readFileSync(new URL('../tools/esperar-saida.mjs', import.meta.url), 'utf8');

  for (const [nome, src] of [['smoke-offline', OFF], ['smoke-browser', BROW]]) {
    // Tolera outros nomes na MESMA importação (o módulo também exporta o
    // esperador genérico): o que o guard cobra é a origem, não a lista.
    assert.match(src, /import \{[^}]*\besperarFimDaSaida\b[^}]*\} from '\.\/esperar-saida\.mjs'/,
      `${nome} não importa a fonte única da espera do esvaziamento`);
    // Reimplementar com `waitForFunction` sobre a fila é exatamente o que
    // quebrou: rAF não dispara em segundo plano, `polling` usa o timer da
    // página (que o runner estrangula), e as opções na posição do ARGUMENTO
    // não valem nada. Sem comentário na conta (gotcha #67).
    const codigo = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.doesNotMatch(codigo, /waitForFunction\([^)]*waze_places_saida/,
      `${nome} voltou a esperar a fila de saída com page.waitForFunction — use esperarFimDaSaida`);

    // E NENHUM `page.waitForFunction`, em espera nenhuma. Isto deixou de ser
    // preferência quando a causa do `EvalError` foi MEDIDA (2026-09-22):
    //
    //   pw1.49.1 (a versão que o CI FIXA), mesma app, mesma CSP, mesmo binário
    //   de Chromium, N=12 por modo de espera —
    //     polling PADRÃO (rAF) ... 4/12 com EvalError na página
    //     polling numérico 250 ... 0/12
    //     poll pelo lado do NODE . 0/12
    //
    // O poller do rAF avalia STRING dentro da página, e a CSP da app (que com
    // razão não tem `unsafe-eval`) o barra — vira promessa rejeitada, o
    // `unhandledrejection` da própria app a registra, e o smoke acusa "erro de
    // JS" que é do INSTRUMENTO. ~22% de taxa: some numa rodada e volta na
    // outra, que é como ele reprovou o CI uma vez e nunca aqui.
    assert.doesNotMatch(codigo, /page\.waitForFunction\(/,
      `${nome} voltou a usar page.waitForFunction — sob a CSP desta app o poller ` +
      'do rAF evalua string e vira EvalError intermitente. Use esperarNaPagina/esperarOuExplodir.');
  }
  // E o módulo tem que continuar pollando pelo lado do NODE, por sinal
  // POSITIVO e dizendo o motivo. Sem isto ele vira outro waitForFunction.
  // Sem o comentário na conta: ele CITA `waitForFunction` justamente pra
  // explicar por que não se usa, e o guard reprovava o arquivo certo — gotcha
  // #67 dentro do guard escrito pra evitar o erro que o #67 descreve.
  const modCodigo = MOD.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(modCodigo, /waitForFunction/,
    'a fonte única passou a usar waitForFunction — é justamente o que ela existe pra evitar');
  assert.match(MOD, /motivo: 'fila-vazia'/, 'sumiu o sinal positivo de fim');
  assert.match(MOD, /motivo: 'TETO'/, 'sumiu o teto — sem ele a espera pode não terminar nunca');
  // O irmão que EXPLODE tem que existir: sem ele, trocar uma espera que hoje
  // LANÇA por uma que volta `{ok:false}` rebaixa falha alta a silenciosa.
  assert.match(MOD, /export async function esperarOuExplodir/,
    'sumiu o esperarOuExplodir — sem ele a conversão silencia falhas que hoje param o smoke');
  assert.match(MOD, /if \(!r\.ok\) throw new Error/,
    'o esperarOuExplodir parou de lançar — virou mais uma espera calada');
});

// ── Os smokes têm que honrar o playwright FIXADO no repo, não o do sandbox ──
//
// MEDIDO em 2026-09-22: `import()` do pacote PUBLICADO (CJS `index.js`) POR
// CAMINHO devolve um namespace só com `default` — `mod.chromium` vem
// `undefined`. Dois smokes faziam `({ chromium } = await import(caminho))` e,
// como o laço só segue se `chromium` for verdadeiro, a primeira tentativa (a
// que existe justamente pra pegar o playwright do repo) falhava CALADA:
// localmente caía no global do sandbox (1.56) e no CI só funcionava porque a
// TERCEIRA tentativa usa especificador bare, que traz os nomeados.
//
// O custo disso não foi teórico. O `EvalError` do smoke do offline ficou três
// rodadas como "não reproduz aqui" — e não reproduzia porque aqui nunca rodava
// a versão do CI. Com o carregador consertado, `npm i --no-save
// playwright@1.49.1` passou a bastar, e o antes/depois saiu na hora:
// código de 4963e0c 2/6 rodadas com EvalError, código de hoje 0/6.
test('todo smoke aceita o playwright do REPO, e não só o do sandbox', () => {
  const SMOKES = ['smoke-offline', 'smoke-browser', 'smoke-presenca', 'smoke-fluxo'];
  let olhados = 0;
  for (const nome of SMOKES) {
    const src = readFileSync(new URL(`../tools/${nome}.mjs`, import.meta.url), 'utf8');
    // Sem comentário na conta (gotcha #67): este arquivo CITA o padrão errado
    // pra explicar por que ele é errado.
    const codigo = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    if (!/resolve\('playwright'/.test(codigo)) continue;   // não abre browser
    olhados++;
    assert.doesNotMatch(codigo, /\(\s*\{\s*chromium\s*\}\s*=\s*await import\(/,
      `${nome} desestrutura 'chromium' direto do import — por CAMINHO isso vem undefined ` +
      'e o smoke cai calado no playwright do sandbox em vez do FIXADO no repo');
    assert.match(codigo, /mod\s*&&\s*mod\.chromium\s*\?\s*mod\s*:\s*\(mod\s*&&\s*mod\.default\)/,
      `${nome} não aceita a forma CJS (namespace só com 'default') — a tentativa que ` +
      'honra o playwright do repo volta a falhar em silêncio');
  }
  assert.equal(olhados, 4, `esperava 4 smokes que carregam playwright, achei ${olhados} — o guard perdeu alcance`);
});
