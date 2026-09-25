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
  // O varredor acima só enxerga quem ESCREVE `imageUrls` na linha — e a tira
  // do lightbox (`im.src = u`) e o aquecimento do resto do card (`aquecer(u)`)
  // escapavam dele por receberem a URL numa variável. Os dois pediam a foto
  // CRUA enquanto a grande pedia com sufixo: com sinal, cópia baixada à toa;
  // sem ele, miniatura quebrada. Daí a regra pelo CONCEITO: todo `aquecer(`
  // ou é de TILE (dentro do laço do `tilesDoCard`, na mesma linha) ou passa
  // pelo `urlDaFoto`.
  assert.match(APP_SEM, /im\.src = urlDaFoto\(u\)/, 'a tira do lightbox voltou a pedir a foto crua');
  const chamadas = APP_SEM.split('\n').filter((l) => /\baquecer\(/.test(l) && !/function aquecer\(/.test(l));
  assert.ok(chamadas.length >= 4, `achei ${chamadas.length} chamadas de aquecer — o varredor quebrou`);
  for (const l of chamadas) {
    assert.ok(/aquecer\(urlDaFoto\(/.test(l) || /of tilesDoCard\([^)]*\)\) aquecer\(u\)/.test(l),
      `aquecimento de foto sem passar pelo urlDaFoto: ${l.trim()}`);
  }
});

// ── A foto guardada tem que ser a foto que o card MOSTRA ─────────────────────
//
// Num pedido de FOTO o carrossel abre na foto EM DECISÃO (a denunciada ou a
// proposta), e o aquecimento e a varredura do offline pegavam `imageUrls[0]`
// por conta própria. MEDIDO na fila do owner: em 13 de 76 pedidos de foto a em
// decisão não é a primeira — a varredura guardava a errada e, sem rede, o card
// abria na que ninguém guardou, com "a foto precisa de sinal" e ✕/✓ travados.
test('card, aquecimento e varredura escolhem a foto pela MESMA regra (fotosDoCard)', () => {
  const regra = fatiar('fotosDoCard');
  assert.match(regra, /flagEntityID/, 'a regra perdeu a foto DENUNCIADA');
  assert.match(regra, /updateRequestID/, 'a regra perdeu a foto PROPOSTA');
  assert.match(regra, /inicial: emDecisao >= 0 \? emDecisao : 0/,
    'sem foto em decisão o card abre na primeira — e só aí');
  for (const nome of ['renderCardImages', 'aquecerPrimeiroSlide', 'aquecerRestoDoCard', 'offlineItensDaFila']) {
    const c = fatiar(nome);
    assert.match(c, /fotosDoCard\(/, `${nome} voltou a escolher a foto por conta própria`);
    assert.doesNotMatch(c, /imageUrls\[0\]/, `${nome} voltou a pegar a PRIMEIRA foto da lista`);
    assert.doesNotMatch(c, /flagEntityID|updateRequestID/,
      `${nome} recopiou a regra da foto em decisão — duplicada, ela diverge (foi o defeito)`);
  }
  // E cada consumidor usa o índice INICIAL, não a primeira da lista devolvida.
  assert.match(fatiar('renderCardImages'), /let currentImgIdx = fotos\.inicial;/,
    'o carrossel deixou de abrir na foto em decisão');
  assert.match(fatiar('aquecerPrimeiroSlide'), /aquecer\(urlDaFoto\(f\.urls\[f\.inicial\]\)\)/,
    'o aquecimento do próximo card deixou de mirar a foto em que ele abre');
  assert.match(fatiar('offlineItensDaFila'), /const f = fotos\.urls\[fotos\.inicial\];/,
    'a varredura deixou de guardar a foto em que o card abre');
  // O resto do card não repete a inicial (já foi no 1º slide) e o teto conta com ela.
  assert.match(fatiar('aquecerRestoDoCard'), /filter\(\(_, i\) => i !== f\.inicial\)/,
    'o resto do card voltou a pular a [0] em vez da foto que já foi aquecida');
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
  // Fila vazia E nada desistido por rede (ver `offlineVarrer`).
  assert.match(antes, /if \(!pend\.length && !desistidosPorRede\.length\)/,
    'a atribuição tem que estar COLADA na condição de fila vazia');
});

test('`onLine` é usado de UMA MÃO só: só o false muda comportamento', () => {
  const corpo = fatiar('offlineVarrer');
  assert.match(corpo, /navigator\.onLine === false/,
    '`true` não prova rede (portal cativo mente) — só o false pode barrar');
  assert.ok(!/navigator\.onLine === true/.test(corpo),
    'nada pode depender de onLine ser true');
});

test('a varredura dorme quando ninguém está usando o app', () => {
  assert.match(fatiar('offlineVarrer'), /OFFLINE_OCIOSO_MS/,
    'sem isso o app cobra dados de quem o deixou aberto no bolso');
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
// então TODO tile era bloqueado ANTES da rede, sem erro no console do app.
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
  // O ÚLTIMO "pronto" — o de exclusão, que vale com rede. (O primeiro é o do
  // "pronto sem rede", que só vale com a janela ATUAL completa.)
  const iPronto = corpo.lastIndexOf("prefs.offline.prontoA");
  assert.ok(iPar > 0 && iPronto > iPar,
    'o ramo do parcial tem que vir ANTES do de pronto, senão ele nunca é alcançado');
  // E o "ainda não preparado" também vem antes dele: cair no "Pronto" por
  // exclusão, sem varredura nenhuma, era a linha mentindo (auditoria 2026-09-25).
  const iPend = corpo.indexOf('prefs.offline.pendenteA');
  assert.ok(iPend > 0 && iPend < iPronto, 'o "Pronto" voltou a ser o ramo de quem nunca preparou nada');
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

// ── O service worker é EFÊMERO, e a lista de tiles tem que sobreviver a isso ─
//
// Este guard se chamava "a lista de tiles guardados é hidratada e SE MANTÉM
// VIVA" — e cobrava a leitura no `activate` e no aviso da varredura, mas não na
// PARTIDA do worker. O título prometia exatamente o que o código não fazia: o
// Chrome encerra o worker ocioso em ~30s e o recria com as globais zeradas, e o
// `activate` não roda numa recriação. RELATADO pelo owner no Android (mapa sem
// um tile, com 243 guardados) e reproduzido encerrando o worker pelo DevTools
// Protocol. O smoke (`7c`) prova o comportamento; este trava a forma no fonte.
test('a lista de tiles guardados é lida em TODA partida do worker, não só no activate', () => {
  assert.match(SW_SEM, /function hidratarTiles\(/);
  // Linha própria, na coluna 0: é o TOPO do script, que roda a cada partida.
  // Dentro de listener ele só roda no evento — que é o defeito.
  assert.match(SW_SEM, /^hidratarTiles\(\);$/m,
    'hidratarTiles() saiu do topo do service-worker.js — o worker recriado pelo Android acorda sem saber de tile nenhum');
  assert.match(SW_SEM, /hidratarTiles\(\)[\s\S]{0,60}clients\.claim/,
    'tem que hidratar no activate também');
  assert.match(SW_SEM, /TILES_GUARDADOS[\s\S]{0,140}hidratarTiles\(\)/,
    'e re-hidratar quando o app avisa, senão só saberia na próxima partida');
  // A janela logo depois de acordar: a lista ainda está sendo lida e o
  // `respondWith` tem de ser decidido já. Sem o ramo, o PRIMEIRO pedido depois
  // da recriação vai pra rede — e o card pede todos os tiles de uma vez.
  assert.match(SW_SEM, /if \(tilesHidratados\)/,
    'sumiu a distinção entre lista pronta e lista ainda sendo lida');
  assert.match(SW_SEM, /respondWith\(hidratacao\.then\(/,
    'na janela logo depois de acordar, o tile tem de ESPERAR a leitura da lista');
  assert.match(APP_SEM, /postMessage\(\{ type: 'TILES_GUARDADOS' \}\)/,
    'o app precisa avisar o SW depois de guardar');
});

// ── "Sem rede" não é "sem foto" ──────────────────────────────────────────────
//
// O aviso "a foto precisa de sinal" era posto no RENDER, por suposição
// (`offline` + tipo de foto), antes de a imagem tentar — e escondia a foto que a
// varredura tinha acabado de guardar. No diagnóstico do owner as três fotos
// dos cards de "Nova foto" estão `quebrada: false`, sem rede: o cache funcionou,
// o app é que as escondeu.
test('o aviso "a foto precisa de sinal" nasce da FALHA da foto, nunca da suposição', () => {
  assert.doesNotMatch(fatiar('renderCurrentCard'), /marcarCardSemFoto\(/,
    'renderCurrentCard voltou a pôr o aviso por suposição — esconde a foto guardada antes de ela carregar');
  assert.match(fatiar('renderCardImages'), /img\.onerror = \(\) => \{[\s\S]{0,300}marcarCardSemFoto\(card, place\)/,
    'o aviso tem de vir do onerror da foto em decisão');
});

test('a trava de ação respeita o card sem foto — terminar a ação anterior não reabre ✕/✓', () => {
  const t = fatiar('aplicarTravaDeAcao');
  assert.match(t, /querySelector\('\.card-sem-foto'\)/,
    'aplicarTravaDeAcao voltou a ignorar o card sem foto');
  assert.match(t, /b\.disabled = travado \|\| \(semFoto && cls !== '\.card-btn-skip'\)/,
    'sem foto, ✕ e ✓ ficam travados e o ↑ vivo — a regra mora nesta função só (gotcha #63)');
});

// ── A janela do sufixo sobrevive ao app renascer ─────────────────────────────
//
// Ela morava só em memória: o app REABERTO sem rede (o Android encerra o app
// em segundo plano) nascia com a janela nula, pedia a foto CRUA — que a
// varredura nunca guarda — e todo card de foto abria com "precisa de sinal".
test('a janela servida é GRAVADA quando vira e VOLTA na abertura sem rede', () => {
  assert.match(fatiar('offlineVarrer'), /offlineJanelaServida = janela;\s*offlineGravarJanela\(janela\);/,
    'a janela tem de ser gravada no MESMO tique em que vira — sem await antes, um "Sair"'
    + ' logo depois entra na fila do IndexedDB atrás dela e apaga tudo');
  const abrir = fatiar('offlineTentarAbrirSemRede');
  const iLer = abrir.indexOf('offlineLerJanela()');
  const iCard = abrir.indexOf('showCurrentPlace()');
  assert.ok(iLer > 0 && iCard > iLer, 'a janela tem de voltar ANTES do primeiro card nascer');
  assert.match(abrir, /if \(offlineJanelaServida === null\) offlineJanelaServida = janelaGuardada;/,
    'com o app vivo a janela de memória é a mais nova — a guardada só entra quando não há outra');
  // Mesma base da fila, e é ela que o "Sair" e o desmarcar apagam.
  assert.match(fatiar('offlineGravarJanela'), /OFFLINE_STORE/, 'a janela saiu da base que o esquecer apaga');
  assert.match(fatiar('offlineEsquecer'), /deleteDatabase\(OFFLINE_DB\)/,
    'o esquecer parou de apagar a base — a janela (e a fila) sobreviveriam ao "Sair"');
});

// ── A caixa do mapa encolhe com o texto, e o zoom muda com ela ───────────────
test('a varredura guarda os tiles da FAIXA de alturas, com piso amarrado ao CSS', () => {
  const itens = fatiar('offlineItensDaFila');
  assert.match(itens, /tilesDaFaixa\(/, 'a varredura voltou a usar UMA caixa só');
  assert.match(itens, /AppState\.queue\.slice\(\)/,
    'o laço cede a thread: tem de iterar uma CÓPIA, senão o avanço da fila pula um pedido calado');
  assert.match(fatiar('offlineFaixaDeCaixas'), /MAPA_TILE - 8/,
    'o teto tem de ficar abaixo de um tile: acima de 504px o custo dobra (medido: 313 → 470 tiles)');
  // O piso NÃO pode ficar acima do menor `min-height` do `.card-photo`: se o
  // CSS deixar a caixa encolher mais, o zoom cai mais e o mapa fica com buraco
  // sem rede. O deitado (`min-height: 0`) é GRADE, com a foto na coluna ao lado
  // e altura cheia — não entra na conta, e o regex só pega `rem`.
  const piso = Number((APP_SEM.match(/const OFFLINE_CAIXA_MIN_REM = ([\d.]+);/) || [])[1]);
  const CSS = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  const pisos = [...CSS.matchAll(/\.card-photo[^{]*\{[^}]*?min-height:\s*([\d.]+)rem/g)].map((x) => Number(x[1]));
  assert.ok(pisos.length >= 2, `achei ${pisos.length} pisos de .card-photo no CSS — o extrator quebrou`);
  assert.ok(piso > 0 && piso <= Math.min(...pisos),
    `o CSS deixa a caixa encolher até ${Math.min(...pisos)}rem, e a varredura só cobre até ${piso}rem`);
});

// ── O BURACO ESTRUTURAL: nenhum teste ligava o service worker ─────────────
//
// Os DOIS defeitos de produção passaram pela mesma razão: o smoke tinha 47
// contextos com `serviceWorkers: 'block'` e ZERO com 'allow'. O SW nunca foi
// exercitado, então quebrá-lo não reprovava nada.
//
// Este guard é META de propósito: ele não testa o app, testa se a COBERTURA
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
  // isso não é uma <img> solta: é o MAPINHA QUE O APP DESENHA. O smoke mede os
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
    'a foto tem que vir de um arquivo REAL do servidor: stub não passa pelo cache'
    + ' HTTP, e o cache é o mecanismo inteiro da foto offline');

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

  // Os TRÊS defeitos do relato de 2026-09-22 e a trava que se desfazia. Cada
  // um passou por uma cobertura que existia e não podia reprovar: a seção 6
  // EXIGIA o aviso como correto, a estrada só usava `NEW_PLACE`, e nenhum teste
  // encerrava o worker nem desenhava um card de caixa curta.
  assert.match(SMOKE, /stopAllWorkers/,
    'sumiu o worker ENCERRADO — o Android faz isso sozinho em ~30s, e sem a seção'
    + ' o defeito da lista de tiles zerada volta sem ninguém ver');
  assert.match(SMOKE, /runningStatus/,
    'o worker encerrado precisa do CONTROLE de que foi mesmo encerrado — sem ele a'
    + ' seção passa com o worker vivo, medindo o caso que já funcionava');
  assert.match(SMOKE, /PRÉ-CONDIÇÃO: a caixa do reporte é mais CURTA e o zoom muda/,
    'o card de caixa curta precisa da pré-condição de troca de zoom — sem ela os'
    + ' tiles da caixa curta são subconjunto dos da alta e qualquer código passa');
  assert.match(SMOKE, /a foto CHEGOU: ela aparece no card de foto/,
    'a seção 6 tem de medir os DOIS lados: foto que chega aparece, foto que não chega avisa');
  assert.match(SMOKE, /a trava SOBREVIVE à ação anterior terminar/,
    'sumiu a prova de que terminar a ação anterior não reabre ✕/✓ num card sem foto');
  assert.match(SMOKE, /k % 4 === 0 \? 'NEW_PHOTO'/,
    'a ESTRADA voltou a só ter NEW_PLACE — o único tipo em que o defeito da foto não aparece');
  assert.match(SMOKE, /temFoto: !!\(pl && /,
    'a ESTRADA tem de saber QUEM TEM FOTO pelo pedido, não pela tela: pela tela, a foto'
    + ' escondida pelo aviso contava como card de mapa e a falha nomeava o sintoma errado');

  // A FOTO OFFLINE vive no cache HTTP do navegador, e o contexto principal do
  // smoke NÃO consegue medi-lo: QUALQUER `route` no contexto desliga esse cache
  // (medido com controle — a mesma foto volta do cache sem rota e quebra com
  // uma rota que nem casa com ela). A seção 6c roda num contexto SEM rota e é a
  // ÚNICA que mede a foto de verdade; com uma rota, passaria a medir o vazio.
  const i6c = SMOKE.indexOf("secao('6c.");
  const f6c = SMOKE.indexOf('ctxFoto.close()');
  assert.ok(i6c > 0 && f6c > i6c, 'sumiu a seção 6c — a foto em decisão e o app reaberto sem rede');
  const bloco6c = SMOKE.slice(i6c, f6c).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(bloco6c, /(ctxFoto|pgFoto)\.route\(/,
    'o contexto da 6c ganhou uma rota — com ela o cache HTTP desliga e a foto offline nunca abre');
  assert.match(bloco6c, /serviceWorkers: 'block'/,
    'a 6c precisa do SW fora: com ele, a foto de mesma origem passaria pelo cache DELE, que o avião não alcança');
  assert.match(bloco6c, /CONTROLE: sem rede, a foto que já veio abre do cache e a nunca pedida quebra/,
    'a 6c perdeu o controle do instrumento nos dois sentidos');
  assert.match(bloco6c, /CONTROLE: nenhuma foto foi pedida CRUA antes da varredura/,
    'a 6c perdeu o controle de que o que abre sem rede veio da varredura');
  assert.match(bloco6c, /flagEntityID: arquivo\(2\)/,
    'a 6c precisa da foto DENUNCIADA fora da 1ª posição');
  assert.match(bloco6c, /updateRequestID: arquivo\(1\)/,
    'a 6c precisa da foto PROPOSTA fora da 1ª posição');
  assert.match(bloco6c, /await offlineTentarAbrirSemRede\(\)/,
    'a 6c tem de reabrir pelo caminho de abertura de verdade');

  // O DIAGNÓSTICO DO OFFLINE (v2026.09.22-03). O relato de 2026-09-22 se
  // resolveu com um arquivo que não DIZIA o que estava errado — dava pra achar
  // lendo 500 KB, sabendo o que procurar. As seções abaixo medem o que o
  // relatório passou a dizer sozinho, e cada uma carrega o lado em que ele tem
  // de ficar CALADO: sem isso, "acusou" passa por vácuo. Lido só o CÓDIGO e
  // ancorado na chamada (`secao(`/`diz(`), porque um comentário citando o
  // rótulo passaria no lugar da seção apagada (gotcha #67).
  const CODIGO = SMOKE.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const exigir = (re, msg) => assert.match(CODIGO, re, msg);
  exigir(/secao\('7d\. A PREPARAÇÃO INTERROMPIDA/,
    'sumiu a preparação interrompida — era o buraco REAL que a sentinela do mapa achou:'
    + ' só a varredura PRONTA avisava o worker, e o que uma parcial guardou não aparecia');
  exigir(/diz\('PRÉ-CONDIÇÃO: a preparação terminou PARCIAL/,
    'a 7d tem de provar que a varredura PAROU no meio — sem isso ela mede a pronta, que já funcionava');
  exigir(/diz\('CONTROLE: o worker NÃO foi recriado no meio/,
    'a 7d precisa do controle de que o worker não renasceu: a partida dele relê o cache e esconde o defeito');
  exigir(/diz\('o worker RECRIADO se apresenta/,
    'o relatório do worker tem de ser medido no worker RECRIADO, que é o caso do Android');
  exigir(/secao\('8b\. O DIAGNÓSTICO ENXERGA O OFFLINE/,
    'sumiu a seção que mede o relatório do offline: a seção nova, a sentinela do mapa e o teto dos recursos');
  exigir(/diz\('CONTROLE: sem o dev, a lista para no teto do navegador/,
    'o teto dos recursos precisa do controle SEM o dev — sem ele, "passou de 300" não prova que foi o dev');
  exigir(/diz\('aviso por cima de foto CARREGADA/,
    'a sentinela da foto tem de ser vista ACUSANDO o defeito encenado, não só calada no caso certo');
  exigir(/diz\('o diário anota a rede CAINDO e depois VOLTANDO/,
    'a ESTRADA perdeu a prova de que o diário carimba a queda e a volta do sinal');
  exigir(/diz\('sem rede, as 6 ações que falharam NÃO viraram erro no console/,
    'a ESTRADA perdeu a prova de que ação sem rede não vira erro no console (eram 16 no relato)');
  exigir(/page\.evaluate\(\(\) => baixarDiagnostico\(\)\)/,
    'o relatório tem de sair pelo caminho do BOTÃO (baixarDiagnostico) — montado à mão, não prova que o arquivo sai');
  exigir(/diz\('o RELATÓRIO de verdade/,
    'sumiu o relatório de VERDADE, baixado e lido pela ferramenta: as peças medidas soltas não provam que o arquivo sai');
  exigir(/diz\('e o worker esquece a LISTA dele/,
    'sumiu a prova de que esquecer limpa também a lista do worker (endereços de pedidos de terceiros)');

  // O APP FECHADO E REABERTO SEM REDE (relato de 2026-09-22, v2026.09.22-04).
  // A seção 5 chamava a função numa página VIVA e o helper `montarNa` fazia
  // `showLoading(false)` por conta própria — o instrumento fazia o que o app
  // esquecia, e o esqueleto por cima do card passou por tudo. A 5b só vale se
  // abrir uma página NOVA e deixar o `initApp` decidir, e se medir o DEDO.
  exigir(/secao\('5b\. FECHAR E REABRIR SEM REDE/,
    'sumiu a reabertura FRIA sem rede — é o único lugar em que o app decide sozinho, sem helper');
  const i5b = CODIGO.indexOf("secao('5b.");
  const bloco5b = CODIGO.slice(i5b, CODIGO.indexOf("secao('6.", i5b));
  assert.match(bloco5b, /const fria = await ctx\.newPage\(\);/, 'a 5b tem que abrir uma página NOVA');
  assert.match(bloco5b, /await fria\.goto\(BASE \+ '\/'/, 'a página nova tem que CARREGAR o app, não receber estado injetado');
  assert.doesNotMatch(bloco5b, /montarNa\(fria/,
    'a página reaberta ganhou o helper de montagem — ele esconde o esqueleto e apaga o defeito que a seção mede');
  assert.match(bloco5b, /document\.elementFromPoint\(/, 'a 5b tem que medir o que o DEDO alcança, não se o card existe');
  assert.match(bloco5b, /ServiceWorker\.stopAllWorkers/, 'a 5b perdeu a variante com o worker encerrado');
  // O controle vem DEPOIS da medida sã: medir com o esqueleto recolocado e
  // chamar isso de "são" passaria por vácuo.
  const iMedida = bloco5b.indexOf('const agora = medir();');
  const iControle = bloco5b.indexOf('showLoading(true);');
  assert.ok(iMedida > 0 && iControle > iMedida,
    'a medida sã da 5b tem que vir ANTES do controle que recoloca o esqueleto');
  exigir(/diz\(`\$\{variante\.nome\}: CONTROLE — com o esqueleto de volta por cima/,
    'a 5b perdeu o controle que prova que o dedo e a sentinela ENXERGAM o esqueleto');
  // E o que o RELATÓRIO passa a contar dessa mesma abertura (v2026.09.22-05):
  // o diário com a tela de carregamento, a captura acusando NO INSTANTE, e o
  // arquivo de verdade lido pelo leitor único — sem o token.
  exigir(/diz\(`\$\{variante\.nome\}: o diário conta a abertura/,
    'a 5b perdeu a linha do tempo da tela de carregamento no diário');
  exigir(/diz\(`\$\{variante\.nome\}: CONTROLE — a captura com o esqueleto por cima ACUSA no instante/,
    'a 5b perdeu a prova de que a CAPTURA acusa no instante (o relatório gerado depois não vê)');
  exigir(/diz\(`\$\{variante\.nome\}: o RELATÓRIO de verdade leva o alerta DA CAPTURA/,
    'a 5b perdeu o caminho inteiro: captura → arquivo → leitor');
  assert.match(bloco5b, /join\(ROOT, 'tools\/diag-resumo\.mjs'\)/,
    'a 5b tem que rodar o LEITOR único no arquivo de verdade, não um parser próprio');

  // O QUE FOI TRATADO NÃO VOLTA (relato de 2026-09-22, v2026.09.22-06). A 5b
  // reabria sem decidir nada e a ESTRADA decidia sem reabrir: nenhuma seção
  // fazia as duas coisas, que é o percurso de quem usa (gotcha #52 — a fixture
  // não tinha a combinação). A 9b só vale se DECIDIR e REABRIR em página nova,
  // com o controle de que a fila guardada continua com os cinco — senão a
  // reabertura esconderia os decididos por outro motivo.
  exigir(/secao\('9b\. O QUE FOI TRATADO NÃO VOLTA/,
    'sumiu a seção que decide e reabre — é o percurso do relato, e nenhuma outra o faz');
  const i9b = CODIGO.indexOf("secao('9b.");
  const bloco9b = CODIGO.slice(i9b, CODIGO.indexOf("secao('10.", i9b));
  assert.match(bloco9b, /await ctx\.newPage\(\)/, 'a 9b tem que reabrir em página NOVA');
  assert.match(bloco9b, /await fria\.goto\(BASE \+ '\/'/, 'a página nova tem que CARREGAR o app');
  assert.doesNotMatch(bloco9b, /montarNa\(/, 'a página reaberta ganhou o helper de montagem — é o app que tem que decidir');
  for (const [re, porque] of [
    [/diz\('CONTROLE: a fila guardada continua com os 5/, 'sem ele, a reabertura esconderia os decididos por outro motivo'],
    [/diz\('reaberta de novo, NENHUM pedido decidido volta como card/, 'é a frase do relato'],
    [/diz\('a ação que estava na janela do Desfazer ao FECHAR sem rede/, 'o caminho síncrono de fechar sem rede'],
    [/diz\('a rede voltou e cada pedido recebeu UMA decisão/, 'o dano no Waze: a mesma decisão mandada de novo'],
    [/diz\('o placar contou cada PEDIDO uma vez/, 'o placar conta gesto; a conta tem que ser contra pedidos DISTINTOS'],
    [/diz\('CONTROLE: com um pedido da fila de saída na tela, a sentinela ACUSA/, 'sem ele, "não acusa" passa por vácuo'],
    [/diz\('PRÉ-CONDIÇÃO: a lista da busca tinha os dois/, 'sem ela, a corrida da busca pode não ter acontecido'],
    [/diz\('reaberta COM rede, nem o que pousou no meio da busca/, 'o mesmo buraco com rede, na abertura'],
  ]) assert.match(bloco9b, re, `a 9b perdeu uma medida — ${porque}`);
  // A chave é calculada na mão, sem função nova do app: assim a seção roda
  // igual contra o app de ANTES do conserto, que é como se prova que ela
  // reprova o defeito (10 falhas lá, 0 aqui).
  assert.doesNotMatch(bloco9b, /chaveDoPedido|offlineLerPousos|semOsJaDecididos/,
    'a 9b passou a depender de função nova do app — não roda mais contra a de antes, e a prova do conserto some');

  // O DIAGNÓSTICO QUE SOBREVIVE A FECHAR O APP (mesmo relato, v2026.09.22-06):
  // "usei o FAB 2 vezes, fechei e abri a aplicação e o número sumiu". A 9c só
  // vale se TOCAR o botão de verdade (toque do DevTools, contexto com toque),
  // fechar como o usuário fecha, e medir cada saída do que foi guardado.
  exigir(/secao\('9c\. O DIAGNÓSTICO SOBREVIVE A FECHAR O APP/,
    'sumiu a seção do diagnóstico entre aberturas — é o relato do número sumindo do botão');
  const i9c = CODIGO.indexOf("secao('9c.");
  const bloco9c = CODIGO.slice(i9c, CODIGO.indexOf("secao('10.", i9c));
  assert.match(bloco9c, /hasTouch: true, isMobile: true/, 'a 9c tem que rodar num contexto com TOQUE — o botão responde a toque');
  assert.match(bloco9c, /Input\.dispatchTouchEvent/, 'a 9c tem que TOCAR o botão, não chamar a captura por fora');
  assert.doesNotMatch(bloco9c, /dlogCapturar\(/, 'a 9c chamou a captura por fora — o toque de verdade é o que se mede');
  assert.match(bloco9c, /\.close\(\{ runBeforeUnload: true \}\)/, 'a 9c tem que fechar como o usuário fecha (pagehide/visibilitychange)');
  // Ir pro FUNDO sem descarregar: descarregar aborta o IndexedDB em voo, e aí
  // "guarda a captura já baixada" e "grava sem o modo dev" passavam limpas
  // (medido: as duas sabotagens sobreviveram antes disto).
  assert.match(bloco9c, /await irProFundo9c\(semDev\);/, 'a 9c tem que ir pro fundo com o modo dev DESLIGADO — é onde "grava sem o dev" apareceria');
  assert.match(bloco9c, /const tocouPos = await tocar9c\(/, 'a 9c perdeu a captura DEPOIS do download — é ela que separa guardar o não entregue de guardar tudo');
  for (const [re, porque] of [
    [/diz\('com o modo dev DESLIGADO, abrir e ir pro fundo não cria nada/, 'quem não liga o modo dev não paga nada'],
    [/diz\('REABERTA, o número do botão continua 2/, 'é a frase do relato'],
    [/diz\('CONTROLE: nenhuma captura NESTA abertura/, 'sem ele, o número podia vir de uma captura nova'],
    [/diz\('o RELATÓRIO leva a abertura anterior inteira/, 'o arquivo de verdade, lido pela ferramenta'],
    [/diz\('o resumo e o leitor mostram o defeito capturado ANTES de fechar/, 'o motivo de guardar'],
    [/diz\('BAIXADO, o que estava guardado sai do aparelho/, 'o que foi entregue não fica'],
    [/diz\('o que foi BAIXADO não volta/, 'o que foi entregue não volta'],
    [/diz\('a abertura guardada há MAIS de 24 h sai do aparelho/, 'o prazo que a Ajuda promete'],
    // Desde a auditoria de 2026-09-25 são DOIS toques com captura não baixada:
    // o 1º só avisa (e o que existe fica), o 2º desliga e apaga.
    [/diz\('com captura NÃO baixada, o 1º toque em desligar só AVISA/, 'o aviso vem ANTES de apagar, não junto'],
    [/diz\('o 2º toque DESLIGA o modo dev e apaga o guardado/, 'desligado é desligado'],
    [/diz\('o SAIR apaga o que foi guardado/, 'sair é sair de tudo'],
  ]) assert.match(bloco9c, re, `a 9c perdeu uma medida — ${porque}`);

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
    //   pw1.49.1 (a que o CI fixava até 2026-09-23), mesmo app, mesma CSP, mesmo binário
    //   de Chromium, N=12 por modo de espera —
    //     polling PADRÃO (rAF) ... 4/12 com EvalError na página
    //     polling numérico 250 ... 0/12
    //     poll pelo lado do NODE . 0/12
    //
    // O poller do rAF avalia STRING dentro da página, e a CSP do app (que com
    // razão não tem `unsafe-eval`) o barra — vira promessa rejeitada, o
    // `unhandledrejection` do próprio app a registra, e o smoke acusa "erro de
    // JS" que é do INSTRUMENTO. ~22% de taxa: some numa rodada e volta na
    // outra, que é como ele reprovou o CI uma vez e nunca aqui.
    assert.doesNotMatch(codigo, /page\.waitForFunction\(/,
      `${nome} voltou a usar page.waitForFunction — sob a CSP deste app o poller ` +
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

// ── O worker responde sobre si, e a varredura sempre o avisa ──────────────
test('o service worker responde ao DIAG e a releitura da lista SEGURA os tiles', () => {
  // O defeito do mapa de 2026-09-22 (o worker acordando sem lembrar dos tiles)
  // não aparecia no relatório: ele só dizia "ativo e controlando".
  assert.match(SW_SEM, /event\.data\.type === 'DIAG' && event\.ports && event\.ports\[0\]/,
    'o worker parou de atender a pergunta do diagnóstico');
  assert.match(SW_SEM, /iniciadoEm: swIniciadoEm, idadeMs: Date\.now\(\) - swIniciadoEm/,
    'a resposta tem que dizer QUANDO o worker nasceu — é o que mostra que ele foi recriado');
  assert.match(SW_SEM, /tilesNaLista: tilesGuardados\.size/, 'a resposta tem que dizer quantos tiles ele conhece');
  assert.match(SW_SEM, /swConta\[hit \? 'doCache' : 'cacheSemEntrada'\]\+\+/,
    'o worker parou de contar o que serviu do cache');
  // A releitura (aviso da varredura) também tem que SEGURAR o tile, senão o
  // tile guardado agora e pedido logo em seguida cai na lista velha.
  const hid = SW_SEM.slice(SW_SEM.indexOf('function hidratarTiles('), SW_SEM.indexOf('hidratacao = (async'));
  assert.match(hid, /tilesHidratados = false;/,
    'a releitura da lista deixou de segurar os tiles — o recém-guardado vai pra rede');
});

test('a varredura avisa o worker em TODO fim, e no meio dela', () => {
  // Só o "pronto" avisava: a preparação INTERROMPIDA (o sinal caindo no meio,
  // o caso comum de quem sai de casa) guardava tiles que o worker não servia.
  const v = fatiar('offlineVarrer');
  const fin = v.slice(v.indexOf('} finally {'));
  assert.match(fin, /if \(epoca === offlineEpoca && tilesNovos\) offlineAnunciarTiles\(\);/,
    'o aviso ao worker voltou a sair só no "pronto"');
  assert.match(v, /\+\+tilesNovos % OFFLINE_ANUNCIAR_A_CADA === 0\) offlineAnunciarTiles\(\);/,
    'a varredura parou de avisar o worker durante o caminho');
  const pronto = v.slice(v.indexOf("offlineUltimoResultado = 'pronto'"), v.indexOf("offlineUltimoResultado = 'parcial'"));
  assert.ok(!/postMessage/.test(pronto), 'o aviso voltou a morar só no ramo do "pronto"');
  assert.match(fatiar('offlineAnunciarTiles'), /offlineUltimoAnuncio = Date\.now\(\);/,
    'o aviso tem que carimbar a hora — a sentinela do tile respeita essa janela');
  // ESQUECER também avisa, e DEPOIS de apagar: a lista do worker é o mesmo dado
  // em memória (endereços de pedidos de terceiros), e relida ANTES do
  // `caches.delete` ela sairia cheia de novo. Só código, sem comentário (#67).
  const esq = fatiar('offlineEsquecer').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const iDel = esq.indexOf('caches.delete(OFFLINE_TILES_CACHE)');
  const iAviso = esq.search(/^\s+offlineAnunciarTiles\(\);/m);
  assert.ok(iDel > 0, 'o esquecer deixou de apagar o cache de tiles');
  assert.ok(iAviso > iDel, 'esquecer não avisa o worker DEPOIS de apagar — a lista dele fica com os endereços');
});

// ── o service worker abre o app SEM REDE (auditoria de 2026-09-25) ─────────
test('SW: tudo que a página carrega está nos CRÍTICOS, e eles são atômicos', () => {
  const sw = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const bloco = /const CRITICOS = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(bloco, 'a lista CRITICOS sumiu do service worker');
  const criticos = [...bloco[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const daPagina = [...html.matchAll(/<(?:script[^>]*\bsrc|link[^>]*rel="stylesheet"[^>]*\bhref)="((?!https?:|\/\/)[^"]+)"/g)]
    .map((m) => '/' + m[1].replace(/^\.?\//, ''));
  assert.ok(daPagina.length >= 9, `achei ${daPagina.length} recursos na página — o extrator quebrou`);
  const faltam = daPagina.filter((u) => !criticos.includes(u));
  assert.deepEqual(faltam, [], 'a página carrega isto e o worker não guarda na instalação: sem rede, o app abre quebrado');
  assert.ok(criticos.includes('/'), 'a própria página saiu dos críticos');
  assert.ok(!criticos.includes('/index.html'), '`/index.html` é um 307 no Cloudflare: guardado, vira resposta redirecionada que o Chrome recusa');
  assert.match(sw, /cache\.addAll\(CRITICOS\)/,
    'os críticos voltaram a ser tolerantes: instalação pela metade apaga o cache bom no activate');
});

test('SW: a navegação sem rede cai na página guardada mesmo com query (atalho do manifest)', () => {
  const sw = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(sw, /caches\.match\(event\.request, isHTML \? \{ ignoreSearch: true \} : undefined\)/);
  assert.match(sw, /if \(isHTML\) return caches\.match\('\/'\)/);
  assert.doesNotMatch(sw, /caches\.match\('\/index\.html'\)/);
});
