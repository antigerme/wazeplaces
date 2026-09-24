// Mandar o pedido aberto pela conversa: o que trafega, o que se aceita de
// volta, e como o cartão é desenhado.
//
// O js/presenca.js roda INTEIRO no navegador de mentira do
// `_presenca-cliente.mjs` (o `escapeHtml` é o do app.js, fatiado de lá): o
// teste mede o que o cliente FAZ. Desde a fase 3 o pedido vai pelo chat do WME:
// o cartão viaja num campo do contexto que o WME não mostra, e o texto leva a
// pergunta, o 📍 e o link (ver `presenca-cliente.test.mjs`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { novoCliente } from './_presenca-cliente.mjs';

const fonte = readFileSync(new URL('../js/presenca.js', import.meta.url), 'utf8');

// Os nomes que os testes usam, com o `t` do harness devolvendo `chave{vars}`.
function montar() {
  const { P } = novoCliente();
  const t = { presencaHtmlDasMsgs: (conv) => P.presencaHtmlDasMsgs('p1', conv) };
  return { ...P, ...t };
}

const CARD = {
  venueID: '205522459.2055159053.3242788', updateRequestID: 'ur-1',
  name: 'Padaria Estrela do Norte', address: 'R. Aurora, 412',
  categories: ['BAKERY'], updateTypeKey: 'IMAGE',
  imageUrl: 'https://venue-image.waze.com/thumbs/thumb700_A.png',
  lat: -23.5, lon: -46.6, region: 'row',
};
const conv = (msgs) => ({ msgs });
const msgCard = (extra = {}) => ({ meu: true, texto: '', legenda: '', ts: 1, id: 'm1', estado: 'enviada', card: CARD, ...extra });

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
  assert.match(html, /aria-label="presenca\.pedido\.abrir\{&quot;nome&quot;:&quot;Padaria Estrela do Norte&quot;\}"/);
  assert.match(html, /data-msg="0"/, 'sem o índice, o clique não sabe qual pedido abrir');
});

test('pedido: com pergunta, card e texto são UMA mensagem e UM recibo', () => {
  const m = montar();
  const html = m.presencaHtmlDasMsgs(conv([msgCard({ legenda: 'é fachada?' })]));
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
    legenda: '<img src=x onerror=alert(1)>',
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

test('pedido: o cartão que ELA mandou não leva recibo', () => {
  const m = montar();
  const html = m.presencaHtmlDasMsgs(conv([msgCard({ meu: false, estado: null })]));
  assert.match(html, /conversa-pedido dela/);
  assert.ok(!html.includes('presenca-recibo'));
});

// ═══ o que o envio tem que deixar passar ════════════════════════════════════

test('pedido: mandar SÓ o card (sem pergunta) é legítimo — o campo vazio não barra', async () => {
  // Com pedido e sem pergunta a mensagem é legítima: mandar o card pelado é um
  // jeito de perguntar. Pelo caminho de verdade: o `submit` do formulário.
  const c = novoCliente({ api: { chat: () => ({ success: true }) } });
  c.P.presencaMontar();
  c.P.Presenca.aberta = '183164343';
  c.P.Presenca.anexo = CARD;
  c.$('conversaInput').value = '   ';
  c.$('conversaForm').disparar('submit');
  await new Promise((r) => setImmediate(r));
  const envio = c.chamadas.chat.find((x) => x.acao === 'enviar');
  assert.ok(envio, 'o card sem pergunta não saiu');
  assert.ok(envio.texto.startsWith('📍 Padaria Estrela do Norte'), envio.texto);
  assert.equal(c.P.Presenca.anexo, null, 'o anexo não soltou depois de mandar');
  // Sem card e sem texto, nada sai.
  c.$('conversaInput').value = '';
  c.$('conversaForm').disparar('submit');
  await new Promise((r) => setImmediate(r));
  assert.equal(c.chamadas.chat.filter((x) => x.acao === 'enviar').length, 1);
});

test('pedido: o cartão que chega pelo contexto passa pela limpeza campo a campo', () => {
  // O contexto é escrito por OUTRO aparelho (ou por quem quiser mandar pelo
  // WME): o cartão dele não entra na tela sem passar pelo `presencaCardSeguro`.
  const m = montar();
  const vindo = m.presencaMsgDoWaze({
    id: 'x', ts: 1, de: { tipo: 1, id: '183164343' }, texto: '📍 x\nhttps://www.waze.com/editor',
    contexto: { app: 'wazeplaces', card: JSON.stringify({ ...CARD, imageUrl: 'javascript:alert(1)', onerror: 'y' }) },
  }, '12444348');
  assert.equal(vindo.card.imageUrl, null);
  assert.equal('onerror' in vindo.card, false);
  assert.match(fonte, /card = presencaCardSeguro\(JSON\.parse\(ctx\.card\)\)/,
    'o cartão do contexto tem que passar pela limpeza');
});
