// A TELA na rodada 20 da auditoria (lote 24, área "telas: texto grande dos
// diálogos, placar, pílula, paisagem baixa"; relatórios r20-3, r20-7 e r20-8):
// o JS e o CSS de verdade, fatiados do fonte.
//
//  R20-7-01 + R20-8-03 · com o texto do sistema maior os botões dos diálogos, o
//             "Aplicar" dos Filtros, o ✕ do título e a aba "Histórico" saíam da
//             caixa. O conserto de 320 px (R14-8-03) era um `@media` em px; agora
//             é um `@container` em `rem`, na própria linha, com os botões
//             EMPILHADOS quando nem o compacto cabe.
//  R20-8-01 · os rótulos do placar se sobrepunham: o 2×2 de 360 px liga agora por
//             MEDIDA (`vigiarPlacar`), sem nunca piorar a barra ✕ ↑ ✓.
//  R20-3-01 · a pílula da foto ampliada cobria o ✕: os pedaços fixos cedem, mas
//             só depois do nome.
//  R20-8-02 · a primeira medida da barra ✕ ↑ ✓ é síncrona (o card novo não espera o
//             quadro seguinte pra ligar o `card-aperta`).
//  R20-8-04 · o ↑ tem 44 px de piso.
//  R20-8-05 · 568×320 deitado com o aviso "de N na região": a barra sai da tela. NÃO
//             consertado — as duas saídas mexem no que o owner precisa ver antes
//             (ver o relatório do lote); a medida síncrona abaixo é a mesma vigia.
//  R20-7-04 · `dir="auto"` na lista de autores e no nome do perfil.
//
// A medida na tela (por hit-test, por palavra quebrada, por sobreposição, a 1× sem
// um pixel de diferença) está no bloco "TEXTO DO SISTEMA MAIOR: DIÁLOGOS, ABAS,
// PLACAR…" do `tools/smoke-browser.mjs`, com os controles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const APP = ler('js/app.js');
const HTML = ler('index.src.html');
const CSS = ler('css/styles.css');

// Guard lê CÓDIGO, nunca comentário (gotcha #67), tirado por LINHA no JS.
const semComentarioJs = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const semComentarioCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const SEM = semComentarioJs(APP);
const CSS_SEM = semComentarioCss(CSS);

function fatiar(nome, fonte = SEM) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(fonte);
  assert.ok(m, `${nome} sumiu do fonte`);
  let par = 0, i = fonte.indexOf('(', m.index);
  for (let j = i; j < fonte.length; j++) {
    if (fonte[j] === '(') par++;
    else if (fonte[j] === ')' && --par === 0) { i = j + 1; break; }
  }
  let prof = 0;
  for (let j = fonte.indexOf('{', i); j < fonte.length; j++) {
    if (fonte[j] === '{') prof++;
    else if (fonte[j] === '}' && --prof === 0) {
      const corpo = fonte.slice(m.index, j + 1);
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}

// O corpo `{ … }` de uma regra, a partir do seletor (sem aninhar: as regras daqui
// não têm chave dentro de chave, fora o `@container`/`@media`, que se acha à parte).
function regra(seletor, fonte = CSS_SEM) {
  const i = fonte.indexOf(seletor + ' {');
  assert.ok(i >= 0, `regra sumiu: ${seletor}`);
  return fonte.slice(i + seletor.length + 2, fonte.indexOf('}', i));
}
// O texto de um bloco `@container (…) { … }` ou `@media (…) { … }` (uma chave por nível).
function bloco(cabeca, fonte = CSS_SEM) {
  const i = fonte.indexOf(cabeca + ' {');
  assert.ok(i >= 0, `bloco sumiu: ${cabeca}`);
  let prof = 0;
  for (let j = fonte.indexOf('{', i); j < fonte.length; j++) {
    if (fonte[j] === '{') prof++;
    else if (fonte[j] === '}' && --prof === 0) return fonte.slice(i, j + 1);
  }
  throw new Error('não fechou: ' + cabeca);
}
const norm = (s) => s.replace(/\s+/g, ' ').trim();
// O que VALE de uma regra de seletor EXATO, em todo o arquivo: junta as regras `seletor { … }` na ordem e deixa a
// ÚLTIMA declaração de cada propriedade (o empate de especificidade é da ordem, gotcha #27). Só regra no topo (depois
// de `}` ou do começo do arquivo): `.x .lb-pill-nome {` e `.lb-pill-nome:hover {` não são esta.
function declaracoesQueValem(seletor, fonte = CSS_SEM) {
  const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?<=^|\\})\\s*' + escapado + '\\s*\\{([^}]*)\\}', 'g');
  const valem = {};
  let achou = 0;
  for (const m of fonte.matchAll(re)) {
    achou++;
    for (const d of m[1].split(';')) {
      const k = d.indexOf(':');
      if (k < 0) continue;
      const valor = d.slice(k + 1).trim();
      assert.doesNotMatch(valor, /!important/, `${seletor}: !important muda quem vale — o teste não o modela`);
      valem[d.slice(0, k).trim()] = valor;
    }
  }
  assert.ok(achou > 0, `regra sumiu: ${seletor}`);
  return valem;
}

// ═══ R20-7-01 · os dois botões de um diálogo na escala do texto ═══════════════

// Os números que decidem, e de onde vêm (MEDIDOS no app, não supostos): a linha de
// botões de um diálogo tem a largura da tela MENOS 80 px (`p-4` do modal + `p-6`
// do cartão; o rodapé dos Filtros chega ao mesmo valor pelo `px-6` dele) — no
// Galaxy Fold (280 px) são 200 px = 12,5rem, no iPhone SE de 1ª geração (320 px)
// são 240 px = 15rem.
const LINHA_DO_FOLD_REM = (280 - 80) / 16;
const LINHA_DO_SE_1A_REM = (320 - 80) / 16;

test('R20-7-01 · o compacto dos diálogos vale na escala do texto, e só abaixo da linha do SE de 320 px', () => {
  const m = /@container \(max-width: ([\d.]+)rem\) \{\s*\.dialogo-acoes > button \{([^}]*)\}/.exec(CSS_SEM);
  assert.ok(m, 'o `@container` do compacto dos diálogos sumiu');
  const corte = Number(m[1]);
  // A 1× o compacto é a tela de menos de 320 px (o `@media`, que FICA): a linha do
  // SE de 1ª geração (320 px) e tudo acima não pode mudar um pixel.
  assert.ok(corte < LINHA_DO_SE_1A_REM, `o corte (${corte}rem) alcança a linha do SE de 320 px (${LINHA_DO_SE_1A_REM}rem): mudaria o diálogo de hoje`);
  // E tem que alcançar os casos que falhavam: a 360 px a 1,5× a linha é 10rem
  // (logout) e 13rem (Filtros, Resumo); a 320 px a 1,3×, 13,4rem.
  assert.ok(corte >= 13.4, `o corte (${corte}rem) não alcança a linha de 13,4rem que falhava (320 px a 1,3×)`);
  for (const decl of ['min-width: 0', 'padding-left: 0.375rem', 'padding-right: 0.375rem', 'overflow-wrap: break-word', 'hyphens: auto', 'hyphenate-limit-chars: 10 4 4']) {
    assert.ok(norm(m[2]).includes(decl), `o compacto perdeu \`${decl}\``);
  }
  // O `@media` de 320 px segue valendo (o Galaxy Fold a 1×: pixel por pixel).
  const media = bloco('@media (max-width: 319.98px)');
  assert.match(media, /\.dialogo-acoes > button \{[^}]*min-width: 0[^}]*hyphenate-limit-chars: 10 4 4/);
});

test('R20-7-01 · abaixo da linha do Galaxy Fold a 1× os botões EMPILHAM, na ordem do HTML (dismissiva em cima)', () => {
  const m = /@container \(max-width: ([\d.]+)rem\) \{\s*\.dialogo-acoes\.dialogo-acoes > button:not\(\[hidden\]\) \{([^}]*)\}/.exec(CSS_SEM);
  assert.ok(m, 'o `@container` do empilhado sumiu');
  assert.ok(Number(m[1]) < LINHA_DO_FOLD_REM,
    `o corte do empilhado (${m[1]}rem) alcança a linha do Fold a 1× (${LINHA_DO_FOLD_REM}rem): o diálogo de hoje no Fold empilharia`);
  assert.ok(Number(m[1]) > LINHA_DO_FOLD_REM - 0.5, 'o corte do empilhado ficou longe da linha do Fold: some o caso do Fold a 1,3×');
  const decl = norm(m[2]);
  assert.match(decl, /flex: 1 1 100%/, 'o botão empilhado não ocupa a linha toda');
  // O `space-x-3` de três das linhas põe margem na ESQUERDA do 2º botão.
  assert.match(decl, /margin-left: 0/);
  // (0,3,1) tem que passar o (0,3,0) do `space-x-3` do Tailwind, que é quem põe a
  // margem esquerda no 2º botão de três linhas: a classe da linha REPETIDA.
  assert.match(m[0], /\.dialogo-acoes\.dialogo-acoes > button:not\(\[hidden\]\)/,
    'o empilhado perdeu a especificidade: o 2º botão ficaria recuado pela margem do space-x-3');
  // Empilha por QUEBRA de linha (`flex-wrap`), não por `flex-direction`: o
  // contêiner não pode ser estilizado pela própria consulta — e a ordem é a do
  // HTML, a dismissiva em cima e a afirmativa embaixo.
  const linha = regra('.dialogo-acoes');
  assert.match(linha, /container-type: inline-size/);
  assert.match(linha, /flex-wrap: wrap/);
  assert.doesNotMatch(CSS_SEM, /flex-direction:\s*column-reverse/, 'empilhar não pode inverter a ordem (afirmativa à direita/embaixo)');
  // Nenhuma linha de dois botões ficou de fora da classe.
  const linhas = HTML.match(/<div class="dialogo-acoes [^"]*">/g) || [];
  assert.ok(linhas.length >= 7, `só ${linhas.length} linhas com .dialogo-acoes`);
});

test('R20-7-01 · o ✕ do título dos Filtros cede pro título quebrar (R20-8-03)', () => {
  const h3 = /<h3 id="filtersModalTitle"[^>]*>/.exec(HTML);
  assert.ok(h3, 'o título dos Filtros sumiu');
  const cls = /class="([^"]*)"/.exec(h3[0])[1].split(/\s+/);
  assert.ok(cls.includes('min-w-0') && cls.includes('break-words'),
    'o título não cede: com o texto grande ele empurra o ✕ de fechar pra fora do cartão');
  // E quebra na sílaba, não na letra ("préférence/s"): `hyphens: auto` só age quando
  // a palavra não cabe.
  assert.match(norm(regra('#filtersModalTitle')), /(?:^|[{;] )hyphens: auto/, 'o título dos Filtros quebra na letra com o texto grande (a propriedade padrão, não só a -webkit-)');
});

// ═══ R20-8-03 · as abas dos Filtros ═══════════════════════════════════════════

test('R20-8-03 · o rótulo da aba cabe na faixa em qualquer escala: `min(…, 6.3cqw)` ≈ os 12 px do Fold a 1×', () => {
  assert.match(regra('.seg-tabs'), /container-type: inline-size/);
  const base = regra('.seg-tab');
  // Com a RESERVA antes (iOS < 16 não tem `cqw`: a declaração inválida cairia).
  assert.match(norm(base), /font-size: 0\.8125rem; font-size: min\(0\.8125rem, 6\.3cqw\)/);
  // A faixa do Fold a 1× tem 192 px: 6,3% dela são 12,1 px — acima dos 12 px
  // (0,75rem) que o degrau de baixo já usa ali, então o `min` escolhe o `rem` e o
  // Fold não muda. Qualquer tela maior, a 1×, tem 13 px de fábrica ou os 12 do degrau.
  assert.ok(192 * 6.3 / 100 > 0.75 * 16);
  const degrau = bloco('@media (max-width: 320px)');
  assert.match(norm(degrau), /\.seg-tab \{ font-size: 0\.75rem; font-size: min\(0\.75rem, 6\.3cqw\)/);
});

// ═══ R20-8-01 · o placar ═════════════════════════════════════════════════════

test('R20-8-01 · o 2×2 por medida tem as MESMAS regras do `@media` de 360 px, e nenhum `@container` no placar', () => {
  assert.doesNotMatch(CSS_SEM, /#placar \{[^}]*container-type/, 'o placar voltou a ser contêiner: o 2×2 por `rem` empurrava a barra pra fora do card a 1,65×–2×');
  const media = norm(bloco('@media (max-width: 359.98px)'));
  const classe = norm(CSS_SEM.slice(CSS_SEM.indexOf('#placarGrid.placar-2x2 {'), CSS_SEM.indexOf('/* ── Os dois botões de um diálogo')));
  // O MESMO 2×2 (duas colunas, a divisória da 2ª fileira no lugar da lateral)…
  for (const trecho of ['grid-template-columns: repeat(2, minmax(0, 1fr))', '{ border-left-width: 0; }', '{ border-top-width: 1px;']) {
    assert.ok(media.includes(trecho), `o 2×2 do @media perdeu: ${trecho}`);
    assert.ok(classe.includes(trecho), `o 2×2 da classe \`placar-2x2\` perdeu: ${trecho}`);
  }
  // …com o respiro entre fileiras MENOR (a escala maior paga a altura: 1 px a mais
  // tirava o card do S8 a 1,5× da janela). O do Fold a 1× (o `@media`) fica como era.
  assert.ok(media.includes('row-gap: 0.25rem') && media.includes('padding-top: 0.375rem'), 'o 2×2 do Fold a 1× mudou');
  assert.ok(classe.includes('row-gap: 0.125rem') && classe.includes('padding-top: 0.25rem'), 'o respiro do 2×2 por medida mudou');
  assert.match(classe, /#placarGrid\.placar-2x2 > :nth-child\(odd\)/);
  assert.match(classe, /#placarGrid\.placar-2x2 > :nth-child\(n \+ 3\)/);
});

function montarPlacar({ rotulos, pilhaSem2x2 = 600, pilhaCom2x2 = 650, janela = 740, barraCabeCom2x2 = true, semCard = false }) {
  const classes = new Set();
  const escritas = [];
  const quadros = [];
  const celulas = rotulos.map((r) => ({
    children: [{}, { _texto: r, getClientRects: () => [1], clientWidth: r.celula }],
  }));
  const grade = {
    isConnected: true,
    children: celulas,
    getClientRects: () => [1],
    classList: {
      contains: (c) => classes.has(c),
      add: (c) => { escritas.push('+' + c); classes.add(c); },
      remove: (c) => { escritas.push('-' + c); classes.delete(c); },
    },
  };
  const pilha = { getBoundingClientRect: () => ({ bottom: classes.has('placar-2x2') ? pilhaCom2x2 : pilhaSem2x2 }) };
  // O card da frente: a medida dele refaz a decisão (`medir`) e diz se a barra
  // cabe (`cabe`) — a barra só cabe com o 2×2 se o teste mandar.
  const card = {};
  const medidasDaBarra = new WeakMap();
  const chamadas = { medir: 0 };
  const estado = { barraCabe: barraCabeCom2x2 };
  if (!semCard) {
    medidasDaBarra.set(card, { medir: () => { chamadas.medir++; }, cabe: () => (classes.has('placar-2x2') ? estado.barraCabe : true) });
  }
  const document = {
    getElementById: (id) => ({ placarGrid: grade, cardStack: pilha })[id] || null,
    querySelector: () => card,
    createRange: () => { let alvo; return { selectNodeContents: (el) => { alvo = el; },
      getBoundingClientRect: () => ({ width: alvo._texto.texto }) }; },
  };
  class RO { constructor(cb) { this.cb = cb; RO.ultimo = this; this.alvos = []; } observe(a) { this.alvos.push(a); } }
  const janelaGlobal = { addEventListener: () => {} };
  const vigia = new Function('document', 'TOLERANCIA_ARREDONDAMENTO_PX', 'requestAnimationFrame', 'ResizeObserver', 'innerHeight', 'window', 'medidasDaBarra',
    'let medirOPlacarDeNovo = () => {};\nlet medirOPlacarComOCardNovo = () => {};\n' + fatiar('vigiarPlacar') + '\nvigiarPlacar();\nreturn () => ({ de: medirOPlacarDeNovo, card: medirOPlacarComOCardNovo });')(
    document, 2, (f) => quadros.push(f), RO, janela, janelaGlobal, medidasDaBarra);
  const medidas = vigia();
  return { classes, escritas, quadros, chamadas, estado, rodar: () => { while (quadros.length) quadros.shift()(); },
    sincrona: medidas.de, novoCard: medidas.card, RO, celulas };
}
const caber = (texto, celula) => ({ texto, celula });

test('R20-8-01 · o placar: o rótulo que não cabe liga o `placar-2x2`; cabendo, a classe nunca liga e NADA é escrito', () => {
  const ok = montarPlacar({ rotulos: [caber(60, 77), caber(76, 77), caber(40, 77), caber(50, 77)] });
  ok.rodar();
  assert.equal(ok.classes.has('placar-2x2'), false, 'com todo rótulo cabendo a classe ligou — mudaria o placar de hoje');
  assert.deepEqual(ok.escritas, [], 'cabendo, a vigia escreveu no DOM — em regime o custo é zero');
  // 0,5 px de tolerância: o "RECHAZADAS" de 360 px, a 1×, sobra 1 px.
  const justo = montarPlacar({ rotulos: [caber(77.4, 77), caber(40, 77)] });
  justo.rodar();
  assert.equal(justo.classes.has('placar-2x2'), false, '0,4 px de excesso são arredondamento, não rótulo colado');
  const sobra = montarPlacar({ rotulos: [caber(78, 77), caber(40, 77)] });
  sobra.rodar();
  assert.ok(sobra.classes.has('placar-2x2'), 'um rótulo 1 px maior que a célula não ligou o 2×2');
});

test('R20-8-01 · o 2×2 NUNCA piora a barra: se a pilha do card passa da janela com ele, a classe volta atrás', () => {
  const cabe = montarPlacar({ rotulos: [caber(90, 77)], pilhaCom2x2: 740 });
  cabe.rodar();
  assert.ok(cabe.classes.has('placar-2x2'), 'a pilha cabendo na janela com o 2×2 (740 de 740), a classe devia ligar');
  // 1 px já conta: o card do S8 (360×740) a 1,5× com o 2×2 de antes ficava com o fim em 741.
  const umPixel = montarPlacar({ rotulos: [caber(90, 77)], pilhaCom2x2: 741 });
  umPixel.rodar();
  assert.equal(umPixel.classes.has('placar-2x2'), false, '1 px de card fora da janela já é card fora: a classe devia voltar atrás');
  const estoura = montarPlacar({ rotulos: [caber(90, 77)], pilhaCom2x2: 766 });
  estoura.rodar();
  assert.equal(estoura.classes.has('placar-2x2'), false,
    '2×2 deixou a pilha 26 px fora da janela (a barra ✕ ↑ ✓ sai do alcance) e a classe ficou ligada');
  // O vaivém acontece no MESMO quadro (liga, mede, desliga): nada de piscar. (As
  // escritas da proteção contra transição, `placar-medindo` — R21-8-01 —, não são
  // do vaivém: `test/reduzir-movimento-r21.test.mjs` cobra essas.)
  assert.deepEqual(estoura.escritas.filter((e) => !/medindo/.test(e)), ['+placar-2x2', '-placar-2x2']);
});

test('R20-8-01 · o 2×2 NUNCA tira a barra do CARD da frente (375×667 a 1,8×: a pilha cabe na janela, a barra não)', () => {
  const sai = montarPlacar({ rotulos: [caber(90, 77)], pilhaCom2x2: 600, barraCabeCom2x2: false });
  sai.rodar();
  assert.equal(sai.classes.has('placar-2x2'), false,
    'com o 2×2 a barra ✕ ↑ ✓ do card sai do corpo (a pilha segue na janela) e a classe ficou ligada');
  assert.ok(sai.chamadas.medir >= 2, 'o card não refez a decisão dele: com o 2×2 desfeito ele ficaria com as classes do 2×2');
  const cabe = montarPlacar({ rotulos: [caber(90, 77)], barraCabeCom2x2: true });
  cabe.rodar();
  assert.ok(cabe.classes.has('placar-2x2'));
  // Sem card na frente (carregando, "Tudo limpo!") não há barra a perder.
  const semCard = montarPlacar({ rotulos: [caber(90, 77)], semCard: true });
  semCard.rodar();
  assert.ok(semCard.classes.has('placar-2x2'), 'sem card na tela o 2×2 devia ligar');
  // A 1×, em regime, o card não é tocado (custo zero) — nem a cada card novo.
  const regime = montarPlacar({ rotulos: [caber(60, 77)] });
  regime.rodar();
  regime.novoCard();
  assert.equal(regime.chamadas.medir, 0, 'com os rótulos cabendo, a vigia do placar mexeu na medida do card');
  assert.equal(regime.escritas.length, 0);
  // Um card NOVO com o 2×2 ligado: a conta é refeita com a barra dele.
  const ligado = montarPlacar({ rotulos: [caber(90, 77)] });
  ligado.rodar();
  assert.ok(ligado.classes.has('placar-2x2'));
  ligado.estado.barraCabe = false;
  ligado.novoCard();
  assert.equal(ligado.classes.has('placar-2x2'), false, 'o card novo cuja barra não cabe com o 2×2 não desligou o 2×2');
});

test('R20-8-01 · medido LIGADO sem a classe (o texto que volta ao normal desliga) e a medida síncrona pro idioma/tela nova', () => {
  const m = montarPlacar({ rotulos: [caber(90, 77)] });
  m.rodar();
  assert.ok(m.classes.has('placar-2x2'));
  m.celulas[0].children[1]._texto = caber(60, 77);       // o texto voltou ao tamanho normal
  m.rodar();                                              // nada agendou ainda: segue ligado
  assert.ok(m.classes.has('placar-2x2'));
  m.sincrona();                                           // a medida síncrona (o idioma trocou)
  assert.equal(m.classes.has('placar-2x2'), false, 'a medida síncrona não desligou o 2×2 com o rótulo cabendo');
  m.rodar();                                              // a proteção contra transição (R21-8-01) se solta nos quadros seguintes
  // O callback do observer só AGENDA (gotchas #34/#35).
  m.escritas.length = 0;
  m.RO.ultimo.cb();
  assert.deepEqual(m.escritas, [], 'o callback do observer escreveu no DOM');
  assert.equal(m.quadros.length, 1);
});

test('R20-8-01 · quem liga a vigia: o `initApp`, a tela que aparece e a troca de idioma', () => {
  assert.match(SEM, /^\s*vigiarPlacar\(\);/m, 'a vigia do placar não é ligada no setup');
  const idioma = fatiar('aplicarIdioma');
  assert.match(idioma, /medirOPlacarDeNovo\(\)/, 'a troca de idioma não mede o placar de novo');
  const tela = fatiar('showMainScreen');
  assert.ok(tela.indexOf("getElementById('appScreen').classList.remove('hidden')") < tela.indexOf('medirOPlacarDeNovo()'),
    'o placar é medido ANTES de a tela aparecer');
  // E a cada card NOVO (a barra do próximo pode ser mais alta, ou o 2×2 ligou antes
  // de haver card): logo depois da medida da barra do card.
  const card = fatiar('renderCurrentCard');
  assert.ok(card.indexOf('if (medirABarra) medirABarra();') < card.indexOf('medirOPlacarComOCardNovo()'),
    'o placar não confere a barra do card novo (depois da medida da barra dele)');
});

// ═══ R20-3-01 · a pílula da foto ampliada ════════════════════════════════════

test('R20-3-01 · a pílula: o nome cede primeiro (a 1× nenhum pixel muda), depois a idade e os "·"', () => {
  // O contador (primeiro filho) segue inteiro: `flex: none`.
  assert.match(regra('.lb-pill-fixo'), /flex: none/);
  // O nome vai a zero e encolhe 1.000.000× mais que os outros: a 1× eles perdem
  // uma fração de pixel que o layout (1/64 px) nem representa.
  //
  // O valor que VALE, não o texto depois do seletor (R21-3-07): há DUAS regras `.lb-pill-nome {` (a de
  // cima, com o `min-width: 2.5rem` de antes, e a que o R20-3-01 pôs depois), e fatiar o arquivo a partir
  // da primeira devolvia o resto inteiro do CSS — o `min-width: 0` casava com o da regra
  // `.lb-pill-fixo:not(:first-child)` que vem logo abaixo, e o nome voltar ao piso de 2.5rem não
  // reprovava nada (gotcha #67: a asserção era decoração, e a sabotagem a denunciou).
  const nome = declaracoesQueValem('.lb-pill-nome');
  assert.equal(nome['min-width'], '0', 'o nome da pílula voltou a ter piso: ele não cede até zero antes da idade (a última declaração vale)');
  assert.equal(nome['flex-shrink'], '1000000', 'o nome da pílula deixou de encolher 1.000.000× mais que os outros');
  const fixo = norm(regra('.lb-pill-fixo:not(:first-child)'));
  for (const decl of ['flex: 0 1 auto', 'min-width: 0', 'overflow: hidden', 'text-overflow: ellipsis']) {
    assert.ok(fixo.includes(decl), `os pedaços fixos perderam \`${decl}\``);
  }
  assert.match(regra('#lightboxCount'), /max-width: calc\(100vw - 4\.75rem/, 'o teto da pílula (que guarda o ✕) sumiu');
});

// ═══ R20-8-04 · o piso de 44 px do ↑ ═════════════════════════════════════════

test('R20-8-04 · os três botões do card têm piso de 44 px, em px (o dedo não cresce com o texto)', () => {
  assert.match(norm(regra('.place-card .card-actions > button')), /min-width: 44px/);
  // O menor botão de hoje é de 48 px: o piso não toca em nada a 1×.
  assert.match(HTML, /card-btn-skip w-12 h-12/);
});

// ═══ R20-7-04 · dir="auto" ═══════════════════════════════════════════════════

test('R20-7-04 · `dir="auto"` na lista de autores do Histórico e no nome do perfil', () => {
  const autores = fatiar('renderAutores');
  assert.match(autores, /truncate dark:text-slate-200" dir="auto">\$\{escapeHtml\(a\.nome\)\}<\/span>/,
    'o nome do autor na lista do Histórico perdeu o dir="auto"');
  // Desde v2026.10.24 o nome é um <span class="block"> dentro do crachá (o <button>
  // não aceita <p>): a regra é a mesma.
  assert.match(HTML, /<span id="userName"[^>]*\bdir="auto"/, 'o nome do perfil no cabeçalho perdeu o dir="auto"');
  assert.doesNotMatch(HTML, /<span id="userName"[^>]*text-left/);
});

// ═══ R20-8-02 · a vigia da barra: medida síncrona ═════════════════════════════

function montarVigia() {
  const classes = new Set();
  const escritas = [];
  const card = {
    isConnected: true,
    classList: {
      contains: (c) => classes.has(c),
      add: (...cs) => cs.forEach((c) => { escritas.push('+' + c); classes.add(c); }),
      remove: (...cs) => cs.forEach((c) => { escritas.push('-' + c); classes.delete(c); }),
      toggle: (c, on) => { escritas.push((on ? '+' : '-') + c); on ? classes.add(c) : classes.delete(c); return on; },
    },
    querySelector: (s) => (s === '.card-body' ? corpo : null),
  };
  // O quanto a barra passa do corpo, com e sem a classe ligada naquele instante.
  const estado = { sem: 0, aperta: 0, clientHeight: 300 };
  const barra = {
    offsetHeight: 73,
    get offsetTop() {
      return estado.clientHeight + (classes.has('card-aperta') ? estado.aperta : estado.sem) - 73;
    },
  };
  const corpo = {
    children: [{}, {}, barra],
    get clientHeight() { return estado.clientHeight; },
    querySelector: (s) => (s === '.card-actions' ? barra : null),
  };
  const quadros = [];
  class RO { constructor(cb) { this.cb = cb; } observe() {} }
  const vigiar = new Function('TOLERANCIA_ARREDONDAMENTO_PX', 'requestAnimationFrame', 'ResizeObserver', 'medidasDaBarra',
    fatiar('vigiarBarraDeAcoes') + '\nreturn vigiarBarraDeAcoes;')(2, (f) => quadros.push(f), RO, new WeakMap());
  return { card, classes, escritas, estado, vigiar, quadros, rodar: () => { while (quadros.length) quadros.shift()(); } };
}

test('R20-8-02 · a PRIMEIRA medida é síncrona: a classe entra sem esperar o quadro', () => {
  const m = montarVigia();
  m.estado.sem = 88;
  const medir = m.vigiar(m.card);
  assert.equal(typeof medir, 'function', 'a vigia não devolve a medida síncrona');
  assert.equal(m.classes.has('card-aperta'), false, 'a classe entrou antes de alguém pedir a medida');
  medir();
  assert.ok(m.classes.has('card-aperta'), 'a medida síncrona não ligou o card-aperta — o card novo nasceria com a barra fora da tela por alguns quadros');
  // O quadro agendado depois repete a mesma decisão, sem piscar.
  m.escritas.length = 0;
  m.rodar();
  assert.ok(m.classes.has('card-aperta'));
  // Cabendo, a medida síncrona não escreve NADA (custo de um card que já cabe).
  const livre = montarVigia();
  const medirLivre = livre.vigiar(livre.card);
  medirLivre();
  assert.deepEqual(livre.escritas, [], 'a medida síncrona escreveu no DOM com o card cabendo');
});

test('R20-8-02 · quem monta o card faz a medida logo DEPOIS do appendChild, e o de fundo também', () => {
  const frente = fatiar('renderCurrentCard');
  const a = frente.indexOf("document.getElementById('cardStack').appendChild(card);");
  const b = frente.indexOf('if (medirABarra) medirABarra();');
  assert.ok(a > 0 && b > a, 'a medida síncrona da barra não vem depois de o card entrar no documento');
  assert.match(frente, /const medirABarra = vigiarBarraDeAcoes\(card\);/);
  const fundo = fatiar('montarCardDeFundo');
  assert.ok(fundo.indexOf('stack.appendChild(fundo)') < fundo.indexOf('medirABarraDoFundo()'),
    'a medida do card de fundo roda antes de ele estar no documento');
});
