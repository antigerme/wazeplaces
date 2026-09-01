// Atributos de categoria (estacionamento, eletroposto) no diff.
//
// O card mostrava CÓDIGO — `PARKING_LOT.parkingType` com `PUBLIC → PRIVATE`,
// `R_61_TO_100 → R_1_TO_10`. As strings são as OFICIAIS do WME, colhidas da
// página do editor em cada idioma; o português confere byte a byte com o HAR
// que o owner mandou.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function dicionario() {
  const ctx = { navigator: { language: 'pt' }, document: { documentElement: {} } };
  vm.createContext(ctx);
  vm.runInContext(read('js/i18n.js'), ctx);
  return ctx.I18N_DICT;
}
const DICT = dicionario();

// ── o corte, em DECLARAÇÃO e não em distância (gotcha #67) ─────────────────
const fonte = read('js/app.js');
function fatiar(inicio, fim) {
  assert.ok(fonte.includes(inicio), `sumiu do app.js: ${inicio}`);
  assert.ok(fonte.includes(fim), `sumiu do app.js: ${fim} — o corte precisa ser revisto`);
  const a = fonte.indexOf(inicio), b = fonte.indexOf(fim);
  assert.ok(b > a, `${fim} veio ANTES de ${inicio}`);
  return fonte.slice(a, b);
}
const trecho = fatiar('function humanizarEnum(', 'function rotuloDeEnum(');

function montar(lang = 'pt') {
  const escopo = { t: (k) => (Object.prototype.hasOwnProperty.call(DICT[lang], k) ? DICT[lang][k] : k) };
  const nomes = Object.keys(escopo);
  const corpo = trecho + '\nreturn { humanizarEnum, rotuloDeAtributo, valorDeAtributo, ATTR_PREFIXO };';
  return new Function(...nomes, corpo)(...nomes.map((n) => escopo[n]));
}

// ═══ o caso que o owner relatou ════════════════════════════════════════════

test('atributo: o caso do owner sai em português, não em código', () => {
  const m = montar('pt');
  assert.equal(m.rotuloDeAtributo('PARKING_LOT.parkingType'), 'Tipo principal');
  assert.equal(m.valorDeAtributo('PARKING_LOT.parkingType', 'PUBLIC'), 'Público');
  assert.equal(m.valorDeAtributo('PARKING_LOT.parkingType', 'PRIVATE'), 'Privado');
  assert.equal(m.rotuloDeAtributo('PARKING_LOT.estimatedNumberOfSpots'), 'Número de vagas');
  assert.equal(m.valorDeAtributo('PARKING_LOT.estimatedNumberOfSpots', 'R_61_TO_100'), '61-100');
  assert.equal(m.valorDeAtributo('PARKING_LOT.estimatedNumberOfSpots', 'R_1_TO_10'), '1-10');
  assert.equal(m.valorDeAtributo('PARKING_LOT.costType', 'MODERATE'), 'Moderado');
  assert.equal(m.valorDeAtributo('PARKING_LOT.costType', 'FREE'), 'Grátis');
  assert.equal(m.valorDeAtributo('PARKING_LOT.lotType', 'UNDERGROUND'), 'Subsolo');
  assert.equal(m.valorDeAtributo('PARKING_LOT.lotType', 'MULTI_LEVEL'), 'Multinível');
});

// ═══ a armadilha que a varredura de 13 países revelou ══════════════════════

test('atributo: `costType` NÃO pode ser tabela achatada por campo', () => {
  // Existe nas DUAS categorias com conjuntos diferentes. Uma tabela por nome de
  // campo traduziria o `FEE` do eletroposto com a régua do estacionamento.
  const m = montar('pt');
  assert.equal(m.valorDeAtributo('CHARGING_STATION.costType', 'FEE'), 'Pago');
  assert.equal(m.valorDeAtributo('PARKING_LOT.costType', 'EXPENSIVE'), 'Caro');
  // `EXPENSIVE` não existe no eletroposto: tem que cair no fallback, não pegar
  // emprestada a string do estacionamento.
  assert.equal(m.valorDeAtributo('CHARGING_STATION.costType', 'EXPENSIVE'), 'Expensive');
});

test('atributo: o MESMO valor em campos diferentes usa a string do seu campo', () => {
  const m = montar('pt');
  assert.equal(m.valorDeAtributo('PARKING_LOT.parkingType', 'RESTRICTED'), 'Restrito');
  assert.equal(m.valorDeAtributo('CHARGING_STATION.accessType', 'RESTRICTED'), 'Restrito');
  // Os dois calham de coincidir em pt; o que se cobra é a CHAVE separada.
  assert.ok(DICT.pt['card.attr.PARKING_LOT.parkingType.RESTRICTED']);
  assert.ok(DICT.pt['card.attr.CHARGING_STATION.accessType.RESTRICTED']);
});

// ═══ o que NÃO pode ser traduzido ══════════════════════════════════════════

test('atributo: texto livre sai CRU — nome de rede não é enum', () => {
  // `network` traz marca própria (`Belib'`, `ChargeGuru`, `DRIVECO`) e
  // `locationInVenue` traz frase inteira. Humanizar ali corromperia o nome,
  // exatamente como já corrompeu apelido e ID do Google (gotcha #39).
  const m = montar('pt');
  for (const v of ["Belib'", 'ChargeGuru', 'Berliner Stadtwerke',
    'In the car park, to the left of the storefront.']) {
    assert.equal(m.valorDeAtributo('CHARGING_STATION.network', v), null,
      `traduziu texto livre: ${v}`);
  }
  // O RÓTULO desse campo é traduzido — o que não se traduz é o valor.
  assert.equal(m.rotuloDeAtributo('CHARGING_STATION.network'), 'Rede');
});

test('atributo: booleano e objeto não passam pela tabela', () => {
  const m = montar('pt');
  // O booleano é barrado pela MESMA regex do texto livre ('true' é minúsculo).
  // Havia uma linha explícita pra ele no código e ela era morta: a sabotagem
  // que a removia passava limpa. A asserção fica — o que ela trava é o
  // RESULTADO, não a linha.
  assert.equal(m.valorDeAtributo('PARKING_LOT.hasTBR', true), null, 'booleano é Sim/Não');
  assert.equal(m.valorDeAtributo('PARKING_LOT.hasTBR', false), null);
  assert.equal(m.valorDeAtributo('CHARGING_STATION.chargingPorts', { a: 1 }), null);
  assert.equal(m.valorDeAtributo('PARKING_LOT.costType', null), null);
});

test('atributo: valor sem string oficial fica LEGÍVEL, nunca invisível', () => {
  // 7 dos 46 valores observados existem no dado e não na tabela do WME.
  const m = montar('pt');
  assert.equal(m.valorDeAtributo('CHARGING_STATION.paymentMethods', 'MEMBERSHIP_CARD'), 'Membership card');
  assert.equal(m.valorDeAtributo('CHARGING_STATION.accessType', 'CHARGERS_ACCESS_TYPE_UNKNOWN'),
    'Chargers access type unknown');
  // Campo sem string oficial devolve `null`, e QUEM faz o fallback é o render
  // (`rot ?? l.caminho`) — porque ele também precisa saber se pinta como prosa
  // ou como identificador. O caminho cru na tela é o identificador que casa com
  // o WME, então ele continua sendo o fallback certo; o teste da tela abaixo é
  // que trava isso.
  assert.equal(m.rotuloDeAtributo('PARKING_LOT.campoQueNaoExiste'), null);
});

// ═══ as quatro línguas, com a string DAQUELE idioma ════════════════════════

test('atributo: cada idioma usa a string oficial DELE, não a tradução do pt', () => {
  // Gotcha #47: tradução oficial não é literal entre idiomas.
  const esperado = {
    pt: ['Público', 'Grátis', 'Subsolo'],
    en: ['Public', 'Free', 'Underground'],
    es: ['Público', 'Gratis', 'Subterráneo'],
    // 'Souterrain', não 'Sous-sol': a primeira versão deste teste trouxe a
    // MINHA tradução e reprovou contra a oficial. É o gotcha #47 acontecendo
    // dentro do teste que existe pra impedi-lo.
    fr: ['Public', 'Gratuit', 'Souterrain'],
  };
  for (const [lang, [pub, free, under]] of Object.entries(esperado)) {
    const m = montar(lang);
    assert.equal(m.valorDeAtributo('PARKING_LOT.parkingType', 'PUBLIC'), pub, lang);
    assert.equal(m.valorDeAtributo('PARKING_LOT.costType', 'FREE'), free, lang);
    assert.equal(m.valorDeAtributo('PARKING_LOT.lotType', 'UNDERGROUND'), under, lang);
  }
});

test('atributo: as chaves existem nas 4 línguas, sem buraco', () => {
  const chaves = Object.keys(DICT.pt).filter((k) => k.startsWith('card.attr.'));
  assert.ok(chaves.length >= 60, `só ${chaves.length} chaves de atributo — a tabela encolheu`);
  for (const lang of ['en', 'es', 'fr']) {
    const faltando = chaves.filter((k) => !DICT[lang][k]);
    assert.deepEqual(faltando, [], `faltam em ${lang}: ${faltando.slice(0, 5).join(', ')}`);
  }
});

test('atributo: só as DUAS categorias que existem no modelo do Waze', () => {
  // Medido em 13 países, 4.275 locais: `categoryAttributes` só tem
  // PARKING_LOT e CHARGING_STATION. Categoria nova entra com medição, não por
  // palpite.
  const cats = new Set(Object.keys(DICT.pt)
    .filter((k) => k.startsWith('card.attr.'))
    .map((k) => k.split('.')[2]));
  assert.deepEqual([...cats].sort(), ['CHARGING_STATION', 'PARKING_LOT']);
});

// ═══ o escopo: fora de categoryAttributes nada muda ════════════════════════

test('atributo: a tradução é ESCOPADA em categoryAttributes', () => {
  // O diff de objeto é genérico e serve qualquer campo. Aplicar a tabela fora
  // dali traduziria o que não é enum de atributo.
  const render = fonte.slice(fonte.indexOf("const attr = c.field === 'categoryAttributes'"),
    fonte.indexOf("if (c.field === 'geometry')"));
  assert.ok(render, 'o bloco do diff de objeto sumiu');
  assert.match(render, /const rot = attr \? rotuloDeAtributo\(l\.caminho\) : null;/,
    'fora de categoryAttributes não pode haver rótulo traduzido');
  assert.match(render, /rot \?\? l\.caminho/,
    'sem string oficial a tela tem que cair no caminho cru — nunca em vazio');
  // Prosa e identificador não podem compartilhar a régua tipográfica: com
  // `word-break: break-all` o rótulo traduzido parte no meio da palavra
  // ("Número de vaga / s", visto na captura).
  assert.match(render, /diff-obj-rotulo/,
    'o rótulo traduzido precisa da classe que desliga o break-all');
  assert.match(render, /attr \? \(valorDeAtributo\(l\.caminho, v\) \?\? valorDoDiff\(v\)\) : valorDoDiff\(v\)/,
    'o valor tem que cair no valorDoDiff fora de categoryAttributes');
});

test('atributo: item de lista usa o renderizador ÚNICO', () => {
  // Envolver o `itemDeLista` num segundo renderizador é como duas telas do
  // mesmo conceito divergem — o guard de layout já reprova, e este fixa o
  // motivo junto do recurso que tentou fazer isso.
  const render = fonte.slice(fonte.indexOf("const attr = c.field === 'categoryAttributes'"),
    fonte.indexOf("if (c.field === 'geometry')"));
  assert.match(render, /itemDeLista\(vItem\(l, v\), 'diff-add', '\+'\)/);
  assert.equal((render.match(/const item = \(v, cls, sinal\)/g) || []).length, 0);
});

test('atributo: a classe do rótulo desliga o break-all no CSS', () => {
  // Classe que não existe no CSS compilado é indistinguível de classe certa se
  // você olhar só o HTML (gotcha #40).
  const css = read('css/styles.css');
  const bloco = css.match(/\.diff-obj-caminho\.diff-obj-rotulo\s*\{[^}]*\}/);
  assert.ok(bloco, 'a regra do rótulo traduzido sumiu do styles.css');
  assert.match(bloco[0], /word-break:\s*normal/, 'sem isto o rótulo parte no meio da palavra');
  assert.match(bloco[0], /font-family:\s*inherit/, 'prosa em monoespaçado');
  // E ela precisa estar no CSS que a app CARREGA, não só no fonte.
  assert.match(read('css/app.css'), /\.diff-obj-caminho\.diff-obj-rotulo/,
    'faltou rodar `npm run css`');
});

test('atributo: a linha de objeto EMPILHA — senão o conteúdo fica com 40px', () => {
  // MEDIDO num Galaxy Fold (280px) com o pedido real do estacionamento: com
  // `grid-template-columns: auto 1fr`, o rótulo da linha ("Atributos da
  // categoria:") comia a largura e o conteúdo ficava com 40px de 184. A grade
  // interna colapsava pra `15.5px 15.5px 0px` e a linha aparecia como "PA  P".
  //
  // Conferido contra a main ANTES desta mudança: o defeito é IDÊNTICO, então
  // não veio da tradução — ela só o tornou visível, porque agora há texto que
  // vale a pena ler ali. E nada estoura nesse estado, então checagem de
  // transbordo não o encontra: o que denuncia é a largura da coluna.
  const css = read('css/styles.css');
  const regra = css.match(/\.diff-row-obj\s*\{[^}]*\}/);
  assert.ok(regra, 'a regra .diff-row-obj sumiu');
  assert.match(regra[0], /grid-template-columns:\s*1fr\s*;/,
    'a linha voltou a duas colunas — o conteúdo colapsa em tela estreita');
  assert.ok(!/grid-template-columns:\s*auto/.test(regra[0]),
    'coluna `auto` pro rótulo é o que espremia o conteúdo');
  assert.match(read('css/app.css'), /\.diff-row-obj\{[^}]*grid-template-columns:1fr/,
    'faltou rodar `npm run css`');
});
