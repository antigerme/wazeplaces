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
