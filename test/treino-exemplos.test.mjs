// Os EXEMPLOS do treino que não existem em lugar nenhum (auditoria da rodada 10,
// 2026-10-07, R10-7-01). Com a fila real curta, o treino completa com exemplos
// SINTÉTICOS (`Treino.sinteticos`) — na fila vazia, os três. Só os clones de
// pedidos reais (`Treino.neutralizar`) levavam a marca de treino (`_treino`), e
// pros sintéticos o app se comportava como se eles fossem pedidos de verdade.
// MEDIDO no navegador pelo auditor:
//   · a conversa oferecia "Mandar o pedido aberto" e o envio ia ao chat do WME
//     de verdade — "📍 Padaria Exemplo · Novo local" e um link `venues=treino1`
//     que não abre nada —, debaixo da faixa "nada é enviado ao Waze" (t01);
//   · o ↗ do card abria o WME sem nada selecionado (`venues=treino1..3`, sem
//     coordenada), com o próprio `Treino` dizendo que "um treino que leva a um
//     editor vazio ensinaria errado" (t06).
// DECISÃO: os sintéticos são de treino (a guarda do `cardParaConversa` passa a
// valer pra eles), e o card deles fica sem o ↗ — ação impossível sai da frente.
// O clone tem o local real e mantém o ↗.
//
// Os testes RODAM o `Treino`, o `cardParaConversa` e o ↗ de verdade
// (`prepararLinkDoWme`, com o `linkWmeDoPedido`), fatiados do app.js num escopo
// só: o que eles não fornecem é um buraco negro. Cada um tem o CONTROLE que
// prova que o instrumento enxerga (o pedido real que VAI pra conversa, o ↗ do
// clone que abre o lugar certo). O que só o navegador mede — o ↗ escondido de
// verdade na tela, que o CSS poderia desmentir (gotcha #27) — está no smoke de
// layout, nos blocos do treino.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fechar(txt, i, abre = '{', fecha = '}') {
  let prof = 0;
  for (let j = txt.indexOf(abre, i); j < txt.length; j++) {
    if (txt[j] === abre) prof++;
    else if (txt[j] === fecha) { prof--; if (prof === 0) return j + 1; }
  }
  return txt.length;
}
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(m.index, fechar(APP_SEM, i));
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
// A declaração `const NOME = …;` INTEIRA: objeto, lista ou valor de uma linha.
function declaracao(nome) {
  const m = new RegExp('^const ' + nome + ' = ', 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu do app.js`);
  const ini = m.index + m[0].length;
  const c = APP_SEM[ini];
  const fim = c === '{' ? fechar(APP_SEM, ini) : c === '[' ? fechar(APP_SEM, ini, '[', ']') : APP_SEM.indexOf(';', ini);
  return APP_SEM.slice(m.index, fim) + ';';
}
function buracoNegro() {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' || typeof k !== 'string' ? undefined : buracoNegro()),
    apply: () => buracoNegro(), set: () => true,
  });
}
// As funções de verdade num escopo só, com `deps` por fora: o que não está nem
// nelas nem no `globalThis` vira buraco negro.
function rodar(deps, fontes, devolve) {
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : typeof k === 'string' ? buracoNegro() : undefined),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return new Function('__escopo', `with (__escopo) {\n${fontes.join('\n')}\nreturn { ${devolve.join(', ')} };\n}`)(escopo);
}

// Um pedido real mínimo, com o lugar (lat/lon) que o ↗ usa.
const P = (i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, name: 'Local ' + i, address: 'Rua ' + i,
  categories: ['PARK'], updateTypeKey: 'VENUE', imageUrls: [], lat: -23.5, lon: -46.6, creatorId: 900 + i });

// O treino aberto sobre a fila real `fila`: os cards que ele monta (o `cards()`
// de verdade, com os clones e os sintéticos), o `cardParaConversa` e o ↗.
function montar(fila) {
  const AppState = { currentPlace: null, queue: [] };
  const deps = {
    AppState, API: { getRegion: () => 'row' }, t: (k) => k,
    // A foto que o card mostra: aqui, a primeira (nenhum destes tem foto).
    fotosDoCard: (p) => ({ urls: p.imageUrls || [], inicial: 0 }),
  };
  const app = rodar(deps, [declaracao('WME_EDITOR_URL'), declaracao('COORD_CASAS'), declaracao('coordDoLink'),
    declaracao('Treino'), ...['cardParaConversa', 'linkWmeDoPedido', 'prepararLinkDoWme'].map(fatiar)],
  ['Treino', 'cardParaConversa', 'prepararLinkDoWme']);
  app.Treino._salvo = { queue: fila };
  return { app, AppState, cards: app.Treino.cards() };
}

// O ↗ do card de mentira, de verdade o bastante: a classe `hidden` e o `href`.
function link() {
  const classes = new Set();
  const attrs = new Map();
  return {
    classList: {
      add: (x) => classes.add(x), remove: (x) => classes.delete(x), contains: (x) => classes.has(x),
      toggle: (x, f) => { if (f === undefined ? !classes.has(x) : f) classes.add(x); else classes.delete(x); return classes.has(x); },
    },
    get href() { return attrs.get('href') || ''; },
    set href(v) { attrs.set('href', String(v)); },
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    hasAttribute: (k) => attrs.has(k),
    removeAttribute: (k) => { attrs.delete(k); },
    escondido: () => classes.has('hidden'),
  };
}

const FILAS = [['a fila real vazia', [], 3], ['a fila real com 1 pedido', [P(1)], 2]];

test('R10-7-01: os exemplos SINTÉTICOS do treino levam a marca de treino (`_treino`), como os clones — com a fila real vazia e com a curta', () => {
  // CONTROLE: com 3 pedidos reais, o treino é só de clones, todos marcados, e o
  // pedido REAL da fila guardada não ganhou a marca (o clone é fundo).
  const reais = [P(1), P(2), P(3)];
  const c = montar(reais);
  assert.deepEqual(c.cards.map((p) => p.venueID).sort(), ['v1', 'v2', 'v3'], 'CONTROLE: com 3 reais o treino não foi só de clones');
  assert.ok(c.cards.every((p) => p._treino === true && !p._exemplo), 'CONTROLE: um clone ficou sem a marca de treino');
  assert.ok(reais.every((p) => !('_treino' in p)), 'o clone marcou o pedido REAL da fila guardada');
  for (const [nome, fila, sinteticos] of FILAS) {
    const m = montar(fila);
    assert.equal(m.cards.length, 3, `PRÉ-CONDIÇÃO (${nome}): o treino não completou o piso de 3 cards`);
    assert.equal(m.cards.filter((p) => p._exemplo).length, sinteticos, `PRÉ-CONDIÇÃO (${nome}): não vieram ${sinteticos} exemplos sintéticos`);
    for (const p of m.cards) {
      assert.equal(p._treino, true,
        `DEFEITO (${nome}): o card de treino ${p.venueID}${p._exemplo ? ` (o exemplo "${p.name}")` : ''} ficou sem a marca de treino — pro resto do app, ele é um pedido de verdade`);
    }
  }
});

test('R10-7-01: com um card de TREINO na frente — clone ou exemplo sintético —, a conversa não oferece "Mandar o pedido aberto"', () => {
  // CONTROLE: o pedido REAL na frente vai pra conversa, com o lugar e a região.
  const c = montar([]);
  c.AppState.currentPlace = P(1);
  const real = c.app.cardParaConversa();
  assert.ok(real && real.venueID === 'v1' && real.region === 'row',
    `CONTROLE: o pedido real não foi pra conversa (${JSON.stringify(real)}) — o teste perdeu o sentido`);
  for (const [nome, fila] of [...FILAS, ['a fila real cheia', [P(1), P(2), P(3)]]]) {
    const m = montar(fila);
    for (const p of m.cards) {
      m.AppState.currentPlace = p;
      assert.equal(m.app.cardParaConversa(), null,
        `DEFEITO (${nome}): o card de treino ${p.venueID}${p._exemplo ? ` (o exemplo "${p.name}")` : ''} seria mandado ao chat do WME de verdade, debaixo da faixa "nada é enviado ao Waze"`);
    }
  }
});

test('R10-7-01: o ↗ do exemplo SINTÉTICO sai da frente (ele não tem lugar no mapa) — o do clone e o do pedido real abrem o lugar certo', () => {
  const m = montar([P(1)]);
  const clone = m.cards.find((p) => !p._exemplo);
  const exemplos = m.cards.filter((p) => p._exemplo);
  assert.ok(clone && exemplos.length === 2, 'PRÉ-CONDIÇÃO: o treino não misturou o clone e os exemplos');
  // CONTROLE: o pedido real e o clone do treino (o venueID real): na tela, com o lugar.
  const LUGAR = /^https:\/\/www\.waze\.com\/editor\?env=row&lat=-23\.5&lon=-46\.6&zoomLevel=22&venues=v1&venueUpdateRequest=v1&tab=feature_editor$/;
  for (const [nome, p] of [['do pedido real', P(1)], ['do clone do treino', clone]]) {
    const a = link();
    m.app.prepararLinkDoWme(a, p);
    assert.equal(a.escondido(), false, `CONTROLE: o ↗ ${nome} saiu da tela`);
    assert.match(a.getAttribute('href') || '', LUGAR, `CONTROLE: o ↗ ${nome} não abre o lugar certo`);
  }
  for (const p of exemplos) {
    const a = link();
    m.app.prepararLinkDoWme(a, p);
    assert.equal(a.escondido(), true,
      `DEFEITO: o ↗ do exemplo "${p.name}" (${p.venueID}) ficou na tela — ele abre o WME sem nada selecionado`);
    assert.equal(a.hasAttribute('href'), false, `o ↗ escondido do exemplo ${p.venueID} ficou com um link (${a.getAttribute('href')})`);
  }
  // O ↗ volta pro pedido de verdade, se o mesmo elemento servir a outro card.
  const a = link();
  m.app.prepararLinkDoWme(a, exemplos[0]);
  m.app.prepararLinkDoWme(a, P(1));
  assert.ok(!a.escondido() && LUGAR.test(a.getAttribute('href') || ''), 'o ↗ de um pedido de verdade ficou escondido depois de um exemplo');
});

test('R10-7-01: o card monta o ↗ SÓ pelo `prepararLinkDoWme` — escrever o `href` direto voltaria a pôr o ↗ nos exemplos', () => {
  const montarCard = fatiar('montarCard');
  assert.match(montarCard, /\n\s+prepararLinkDoWme\(card\.querySelector\('\.card-wme-link'\), place\);/,
    'o `montarCard` deixou de montar o ↗ pelo `prepararLinkDoWme`');
  // E ninguém mais escreve no ↗ do card: a decisão "exemplo não tem ↗" mora num lugar só.
  const usos = APP_SEM.split('\n').filter((l) => l.includes('card-wme-link'));
  assert.equal(usos.length, 1, `o ↗ do card é escrito fora do \`prepararLinkDoWme\`: ${usos.map((l) => l.trim()).join(' | ')}`);
});
