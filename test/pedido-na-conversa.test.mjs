// Mandar o pedido aberto pela conversa: o que trafega, o que se aceita de
// volta, e como o cartão é desenhado.
//
// O módulo mora no js/presenca.js (script de browser, não módulo), então o
// teste FATIA a fonte — mesmo padrão do test/recibos.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('../js/presenca.js', import.meta.url), 'utf8');

function fatiar(inicio, fim) {
  assert.ok(fonte.includes(inicio), `sumiu do presenca.js: ${inicio}`);
  assert.ok(fonte.includes(fim), `sumiu do presenca.js: ${fim} — o corte precisa ser revisto`);
  const a = fonte.indexOf(inicio), b = fonte.indexOf(fim);
  assert.ok(b > a, `${fim} veio ANTES de ${inicio}`);
  return fonte.slice(a, b);
}
const trecho = fatiar('function presencaResumoDoCard(', 'function presencaConfirmar(')
  + '\n' + fatiar('const PRESENCA_GLIFO = {', 'function presencaRenderConversa() {');

function montar() {
  const escopo = {
    Presenca: { aberta: 'p1', conversas: new Map(), anexo: null },
    document: { visibilityState: 'visible' },
    t: (k, v) => (v && v.nome ? `${k}:${v.nome}` : k),
    // Cópia FIEL do escapeHtml do app.js — dublê mais generoso que o original
    // mede um comportamento que a app não tem.
    escapeHtml: (s) => (s === null || s === undefined ? '' : String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;')),
    presencaRenderConversa: () => {},
  };
  const nomes = Object.keys(escopo);
  const corpo = trecho + '\nreturn { presencaResumoDoCard, presencaCardSeguro, PRESENCA_FOTO_OK,'
    + ' presencaHtmlDoPedido, presencaHtmlDasMsgs, presencaRecibo };';
  return new Function(...nomes, corpo)(...nomes.map((n) => escopo[n]));
}

const CARD = {
  venueID: '205522459.2055159053.3242788', updateRequestID: 'ur-1',
  name: 'Padaria Estrela do Norte', address: 'R. Aurora, 412',
  categories: ['BAKERY'], updateTypeKey: 'IMAGE',
  imageUrl: 'https://venue-image.waze.com/thumbs/thumb700_A.png',
  lat: -23.5, lon: -46.6, region: 'row',
};
const conv = (msgs) => ({ nome: 'carla_am', estado: 'aberta', recibos: true, msgs });
const msgCard = (extra = {}) => ({ meu: true, txt: '', ts: 1, id: 1, estado: 'entregue', motivo: null, card: CARD, ...extra });

// ═══ o que se aceita de volta ═══════════════════════════════════════════════

test('pedido: o que chega é copiado CAMPO A CAMPO, não espalhado', () => {
  // Espalhar (`{...c}`) aceitaria qualquer chave que o outro aparelho
  // inventasse, e ela viajaria pro resto da app sem ninguém ter decidido isso.
  const m = montar();
  const limpo = m.presencaCardSeguro({ ...CARD, __proto__: null, coisaEstranha: 'x', onerror: 'y' });
  assert.equal('coisaEstranha' in limpo, false);
  assert.equal('onerror' in limpo, false);
  assert.deepEqual(Object.keys(limpo).sort(),
    ['address', 'categories', 'imageUrl', 'lat', 'lon', 'name', 'region', 'updateRequestID', 'updateTypeKey', 'venueID']);
});

test('pedido: sem venueID não há pedido', () => {
  const m = montar();
  assert.equal(m.presencaCardSeguro({ ...CARD, venueID: '' }), null);
  assert.equal(m.presencaCardSeguro(null), null);
  assert.equal(m.presencaCardSeguro('texto'), null);
  assert.equal(m.presencaCardSeguro(42), null);
});

test('pedido: a FOTO só passa se for https de um host do waze.com', () => {
  // Ela vira `src` de uma <img>: sem esta trava, quem manda escolhe pra onde o
  // aparelho de quem recebe faz requisição.
  const m = montar();
  const ok = (u) => m.presencaCardSeguro({ ...CARD, imageUrl: u }).imageUrl;
  assert.equal(ok('https://venue-image.waze.com/thumbs/x.png'), 'https://venue-image.waze.com/thumbs/x.png');
  assert.equal(ok('https://world-venue-image.waze.com/a.png'), 'https://world-venue-image.waze.com/a.png');
  for (const mau of [
    'http://venue-image.waze.com/x.png',          // sem TLS
    'javascript:alert(1)',                         // execução
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',  // conteúdo do remetente
    'https://waze.com.exemplo.invalido/x.png',     // sufixo forjado
    'https://exemplo.invalido/x.png',
    '//venue-image.waze.com/x.png',
  ]) assert.equal(ok(mau), null, `passou: ${mau}`);
});

test('pedido: texto que chega tem TETO — nada de string de 10 MB no DOM', () => {
  const m = montar();
  const gigante = 'x'.repeat(5000);
  const limpo = m.presencaCardSeguro({ ...CARD, name: gigante, address: gigante, venueID: gigante });
  assert.equal(limpo.name.length, 200);
  assert.equal(limpo.address.length, 300);
  assert.equal(limpo.venueID.length, 128);
  const cats = m.presencaCardSeguro({ ...CARD, categories: Array(50).fill(gigante) }).categories;
  assert.equal(cats.length, 4);
  assert.equal(cats[0].length, 60);
});

test('pedido: tipo errado vira valor seguro, nunca vaza', () => {
  const m = montar();
  const limpo = m.presencaCardSeguro({
    ...CARD, name: 42, address: {}, categories: 'nao-e-lista',
    lat: 'perto', lon: NaN, region: 'inventada', updateTypeKey: [],
  });
  assert.equal(limpo.name, '');
  assert.equal(limpo.address, '');
  assert.deepEqual(limpo.categories, []);
  assert.equal(limpo.lat, null);
  assert.equal(limpo.lon, null);
  assert.equal(limpo.region, 'row', 'região desconhecida cai no padrão, não vaza');
  assert.equal(limpo.updateTypeKey, null);
});

test('pedido: categoria não-string é descartada item a item', () => {
  const m = montar();
  assert.deepEqual(m.presencaCardSeguro({ ...CARD, categories: ['BAKERY', 7, null, 'PARK'] }).categories,
    ['BAKERY', 'PARK']);
});

// ═══ a palavra é escolhida de quem LÊ ═══════════════════════════════════════

test('pedido: o resumo usa CHAVE de tipo, não texto pronto', () => {
  // Quem manda pode estar em português e quem recebe em francês. O remetente
  // não escolhe a palavra que aparece na tela do outro.
  const m = montar();
  assert.equal(m.presencaResumoDoCard(CARD), 'card.updateType.IMAGE · BAKERY');
});

test('pedido: categoria sai CRUA — o Waze regionaliza por PAÍS, não por idioma', () => {
  // Esta asserção é ESTRUTURAL de propósito. A versão por saída não distinguia
  // as duas versões: o `t` de mentira devolve a própria chave, então traduzir a
  // categoria produz exatamente o mesmo texto e a sabotagem passava limpa
  // (gotcha #67 — asserção que não distingue é decoração).
  const fn = fonte.slice(fonte.indexOf('function presencaResumoDoCard('),
    fonte.indexOf('const PRESENCA_FOTO_OK'));
  assert.ok(fn, 'presencaResumoDoCard sumiu');
  assert.match(fn, /partes\.push\(card\.categories\[0\]\)/,
    'a categoria tem que ir crua pro resumo');
  assert.ok(!/t\(\s*card\.categories/.test(fn),
    'passar a categoria por t() erra em metade dos países que falam o idioma (gotcha #39)');
});

test('pedido: sem tipo e sem categoria o resumo é vazio, não "undefined"', () => {
  const m = montar();
  assert.equal(m.presencaResumoDoCard({ ...CARD, updateTypeKey: null, categories: [] }), '');
});

// ═══ o desenho ══════════════════════════════════════════════════════════════

test('pedido: o cartão é um <button> com rótulo — teclado e leitor chegam nele', () => {
  const m = montar();
  const html = m.presencaHtmlDasMsgs(conv([msgCard()]));
  assert.match(html, /<button type="button" class="conversa-pedido/);
  assert.match(html, /aria-label="presenca\.pedido\.abrir:Padaria Estrela do Norte"/);
  assert.match(html, /data-msg="0"/, 'sem o índice, o clique não sabe qual pedido abrir');
});

test('pedido: com pergunta, card e texto são UMA mensagem e UM recibo', () => {
  const m = montar();
  const html = m.presencaHtmlDasMsgs(conv([msgCard({ txt: 'é fachada?', estado: 'lida' })]));
  assert.match(html, /com-legenda/);
  assert.equal((html.match(/class="presenca-recibo/g) || []).length, 1,
    'dois recibos na mesma mensagem seria contar a mesma entrega duas vezes');
  assert.match(html, /cp-legenda">é fachada\?/);
});

test('pedido: sem pergunta o recibo continua saindo', () => {
  const m = montar();
  const html = m.presencaHtmlDasMsgs(conv([msgCard()]));
  assert.ok(!html.includes('com-legenda'));
  assert.equal((html.match(/class="presenca-recibo/g) || []).length, 1);
});

test('pedido: sem nome, o ENDEREÇO vira o título — mesma regra do card', () => {
  const m = montar();
  const html = m.presencaHtmlDasMsgs(conv([msgCard({ card: { ...CARD, name: '' } })]));
  assert.match(html, /cp-nome">R\. Aurora, 412</);
});

test('pedido: sem nome e sem endereço cai no placeholder, nunca em vazio', () => {
  const m = montar();
  const html = m.presencaHtmlDasMsgs(conv([msgCard({ card: { ...CARD, name: '', address: '' } })]));
  assert.match(html, /cp-nome">card\.noName</);
});

test('pedido: sem foto não se desenha caixa de foto vazia', () => {
  const m = montar();
  const html = m.presencaHtmlDasMsgs(conv([msgCard({ card: { ...CARD, imageUrl: null } })]));
  assert.ok(!html.includes('cp-foto'), 'caixa cinza sem foto é ruído');
  assert.match(html, /cp-nome/, 'mas o resto do cartão continua');
});

test('pedido: nome e legenda saem ESCAPADOS — o texto vem de outro aparelho', () => {
  const m = montar();
  const html = m.presencaHtmlDasMsgs(conv([msgCard({
    txt: '<img src=x onerror=alert(1)>',
    card: { ...CARD, name: '"><script>alert(1)</script>' },
  })]));
  assert.ok(!html.includes('<script'), 'nome não pode injetar tag');
  assert.ok(!html.includes('<img src=x'), 'legenda não pode injetar tag');
  assert.match(html, /&lt;script/);
});

test('pedido: a URL da foto sai escapada dentro do atributo src', () => {
  // O filtro já barra o que não é waze.com, mas o escape é a segunda camada:
  // aspas soltas dentro do atributo fechariam o `src` e abririam outro.
  const m = montar();
  const html = m.presencaHtmlDasMsgs(conv([msgCard({
    card: { ...CARD, imageUrl: 'https://venue-image.waze.com/a"onerror="alert(1)' },
  })]));
  assert.ok(!html.includes('"onerror='),
    'aspa CRUA antes do atributo é o que fecharia o src e abriria outro');
  assert.match(html, /src="https:\/\/venue-image\.waze\.com\/a&quot;onerror=&quot;alert\(1\)"/,
    'a aspa tem que sair como entidade, dentro do mesmo atributo');
});

test('pedido: peer sem recibo desenha o cartão, só sem os tiques', () => {
  const m = montar();
  const html = m.presencaHtmlDasMsgs({ ...conv([msgCard()]), recibos: false });
  assert.match(html, /conversa-pedido/, 'o pedido em si tem que aparecer');
  assert.ok(!html.includes('presenca-recibo'));
});

test('pedido: o cartão que ELA mandou não leva recibo', () => {
  const m = montar();
  const html = m.presencaHtmlDasMsgs(conv([msgCard({ meu: false, estado: null })]));
  assert.match(html, /conversa-pedido dela/);
  assert.ok(!html.includes('presenca-recibo'));
});

// ═══ o que o transporte tem que deixar passar ═══════════════════════════════

test('pedido: mensagem SÓ com card (sem texto) não pode ser descartada', () => {
  // O `onmessage` sai fora quando não há texto. Com pedido e sem pergunta a
  // mensagem é legítima — mandar o card pelado é um jeito de perguntar.
  const recebe = fonte.slice(fonte.indexOf('canal.onmessage = (ev) => {'),
    fonte.indexOf('async function presencaChamar('));
  assert.match(recebe, /if \(!txt && !card\) return;/,
    'o corte por texto vazio tem que considerar o card');
});

test('pedido: o card só entra no que trafega quando existe', () => {
  const envia = fonte.slice(fonte.indexOf('function presencaEntregarMsg('),
    fonte.indexOf('const PRESENCA_PESO'));
  assert.match(envia, /m\.card\s*\n?\s*\?\s*\{ txt: m\.txt, id: m\.id, card: m\.card \}/,
    'mensagem sem card não deve carregar a chave `card` à toa');
});
