// A TELA na rodada 19 da auditoria (lote 23, área "telas: texto grande, RTL e
// idioma"; relatório r19-8): o JS e o CSS de verdade, fatiados do fonte.
//
//  R19-8-01 · com o texto do sistema maior (escala da fonte raiz de 1,3 ou mais)
//             a barra ✕ ↑ ✓ saía do card nas alturas de 667 a 860 px, e a página
//             não rolava. A regra compacta por ALTURA é em px e não enxerga a
//             escala; o conserto é uma segunda rede de segurança, MEDIDA e viva
//             (`vigiarBarraDeAcoes` → `card-aperta`), que com escala 1 e altura de
//             janela normal nunca liga (em janela baixa ela liga a 1×: R21-8-01).
//  R19-8-02 · texto do Waze em hebraico/árabe saía num parágrafo da esquerda pra
//             direita: `dir="auto"` em todo elemento que recebe texto do Waze, e
//             isolamento do nome quando ele vai no meio de uma frase nossa.
//  R19-8-03 · o aviso do Desfazer ficava no idioma de antes se o idioma mudava
//             dentro da janela de 3 s.
//
// A medida na tela (os botões alcançáveis por `elementFromPoint`, a escala 1 sem
// um pixel de diferença) está no bloco "O TEXTO DO SISTEMA MAIOR" do
// `tools/smoke-browser.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const APP = ler('js/app.js');
const PRESENCA = ler('js/presenca.js');
const HTML = ler('index.src.html');
const CSS = ler('css/styles.css');
const I18N = ler('js/i18n.js');

// Guard lê CÓDIGO, nunca comentário (gotcha #67), tirado por LINHA.
const semComentarioJs = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const semComentarioCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const SEM = semComentarioJs(APP);
const SEM_PRESENCA = semComentarioJs(PRESENCA);
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
const constante = (nome) => {
  const m = new RegExp('^const ' + nome + ' = [\\s\\S]*?;\\n', 'm').exec(SEM);
  assert.ok(m, `a constante ${nome} sumiu do app.js`);
  return m[0];
};

// ═══ R19-8-01 · a barra ✕ ↑ ✓ dentro do card com o texto do sistema maior ═════

// Um DOM mínimo: o `corpo` tem a altura que o teste manda (a medida que o layout
// daria) e o `card` guarda as classes. O ResizeObserver de mentira entrega
// quando o teste manda.
function montarVigia({ comResizeObserver = true } = {}) {
  const classes = new Set();
  const escritas = [];
  const card = {
    isConnected: true,
    classList: {
      contains: (c) => classes.has(c),
      add: (c) => { escritas.push('+' + c); classes.add(c); },
      remove: (c) => { escritas.push('-' + c); classes.delete(c); },
      toggle: (c, on) => { escritas.push((on ? '+' : '-') + c); on ? classes.add(c) : classes.delete(c); return on; },
    },
    querySelector: (s) => (s === '.card-body' ? corpo : null),
  };
  // `quantoSobra(classes)`: o que o layout daria COM as classes que estão ligadas
  // naquele instante (com `card-aperta` o card cabe; sem ela, estoura).
  const estado = { semAperta: 88, comAperta: 0, clientHeight: 459 };
  // A barra de ações: o fim dela (offsetTop + offsetHeight) passa do corpo em
  // `semAperta` px sem a classe e `comAperta` px com ela.
  const barra = {
    offsetHeight: 95,
    get offsetTop() { return estado.clientHeight + (classes.has('card-aperta') ? estado.comAperta : estado.semAperta) - 95; },
  };
  const corpo = {
    children: [{ n: 'foto' }, { n: 'texto' }, barra],
    get clientHeight() { return estado.clientHeight; },
    querySelector: (s) => (s === '.card-actions' ? barra : null),
    // O `scrollHeight` do corpo NÃO é o sinal: deitado a coluna do texto o passa
    // com a barra no lugar. Se a vigia voltar a lê-lo, este número a engana.
    scrollHeight: 99999,
  };
  const quadros = [];
  const observadores = [];
  class RO {
    constructor(cb) { this.cb = cb; this.alvos = []; observadores.push(this); }
    observe(el) { this.alvos.push(el); }
  }
  const TOLERANCIA_ARREDONDAMENTO_PX = 2;
  const fonte = fatiar('vigiarBarraDeAcoes');
  // (`medidasDaBarra`, R20-8-01: o registro que o placar consulta; o harness a declara.)
  const vigiar = new Function('TOLERANCIA_ARREDONDAMENTO_PX', 'requestAnimationFrame', 'ResizeObserver', 'medidasDaBarra',
    fonte + '\nreturn vigiarBarraDeAcoes;')(TOLERANCIA_ARREDONDAMENTO_PX, (f) => quadros.push(f),
    comResizeObserver ? RO : undefined, new WeakMap());
  const rodarQuadros = () => { while (quadros.length) quadros.shift()(); };
  return { card, classes, escritas, estado, vigiar, quadros, observadores, rodarQuadros };
}

test('R19-8-01 · a barra fora do card liga o `card-aperta`; cabendo, ele não liga nunca', () => {
  const m = montarVigia();
  m.vigiar(m.card);
  m.rodarQuadros();
  assert.ok(m.classes.has('card-aperta'), 'a barra estourando 88 px do corpo não ligou o card-aperta');

  const livre = montarVigia();
  livre.estado.semAperta = 0;            // escala 1: nada estoura
  livre.vigiar(livre.card);
  livre.rodarQuadros();
  assert.equal(livre.classes.has('card-aperta'), false, 'com a escala 1 o card-aperta ligou à toa — mudaria o card de hoje');
  assert.deepEqual(livre.escritas, [], 'com o card cabendo a vigia escreveu no DOM — em regime o custo é zero');
});

test('R19-8-01 · a tolerância é a do arredondamento (2 px): 2 não liga, 3 liga', () => {
  const a = montarVigia(); a.estado.semAperta = 2; a.vigiar(a.card); a.rodarQuadros();
  assert.equal(a.classes.has('card-aperta'), false, '2 px de sobra são arredondamento do flex, não estouro');
  const b = montarVigia(); b.estado.semAperta = 3; b.vigiar(b.card); b.rodarQuadros();
  assert.equal(b.classes.has('card-aperta'), true, '3 px de sobra já são estouro');
});

test('R19-8-01 · LIGADO, ele mede SEM a classe: a escala que volta a 1 desliga o card-aperta', () => {
  const m = montarVigia();
  m.vigiar(m.card);
  m.rodarQuadros();
  assert.ok(m.classes.has('card-aperta'));
  // Com a escala AINDA grande, uma nova notificação (o card girou, a fonte
  // carregou) não pode desligar a classe: medindo COM ela o card sempre cabe, e a
  // vigia piscaria entre ligado e desligado.
  m.observadores[0].cb();
  m.rodarQuadros();
  assert.ok(m.classes.has('card-aperta'), 'a vigia mediu com a classe ligada e a desligou com o card ainda estourando');
  // A pessoa volta o texto do sistema ao normal: sem a classe o card CABE. Com
  // ela ligada o corpo sempre cabe por construção — se a vigia só medisse
  // assim, jamais desligaria.
  m.estado.semAperta = 0;
  m.observadores[0].cb();
  m.rodarQuadros();
  assert.equal(m.classes.has('card-aperta'), false, 'o card-aperta ficou ligado depois de o texto voltar ao tamanho normal');
  // E enquanto a escala segue grande, a medida sem a classe confirma e religa.
  m.estado.semAperta = 60;
  m.observadores[0].cb();
  m.rodarQuadros();
  assert.ok(m.classes.has('card-aperta'));
});

test('R19-8-01 · o callback do ResizeObserver só AGENDA (gotchas #34/#35) e observa o card e os filhos do corpo', () => {
  const m = montarVigia();
  m.vigiar(m.card);
  m.rodarQuadros();
  m.escritas.length = 0;
  m.observadores[0].cb();
  assert.deepEqual(m.escritas, [], 'o callback do observer escreveu no DOM — é o laço que virava toast vermelho');
  assert.equal(m.quadros.length, 1, 'o callback não agendou a escrita por requestAnimationFrame');
  m.observadores[0].cb();
  assert.equal(m.quadros.length, 1, 'duas notificações no mesmo quadro agendaram duas escritas');
  assert.equal(m.observadores[0].alvos.length, 1 + 3, 'a vigia deveria observar o card e os 3 filhos do corpo (foto, texto, barra)');
  assert.equal(m.observadores[0].alvos[0], m.card);
});

test('R19-8-01 · card fora do documento não é mexido, e sem ResizeObserver a medição de uma vez ainda roda', () => {
  const fora = montarVigia();
  fora.card.isConnected = false;
  fora.vigiar(fora.card);
  fora.rodarQuadros();
  assert.deepEqual(fora.escritas, []);
  const sem = montarVigia({ comResizeObserver: false });
  sem.vigiar(sem.card);
  sem.rodarQuadros();
  assert.ok(sem.classes.has('card-aperta'));
});

test('R19-8-01 · quem desenha o card liga a vigia, no da frente e no de fundo', () => {
  const frente = fatiar('renderCurrentCard');
  // (R20-8-02: a vigia devolve a medida síncrona, e o card da frente a guarda.)
  assert.match(frente, /^\s*(const \w+ = )?vigiarBarraDeAcoes\(card\);/m, 'o card da frente não ganha a vigia da barra');
  const fundo = fatiar('montarCardDeFundo');
  assert.match(fundo, /^\s*(const \w+ = )?vigiarBarraDeAcoes\(fundo\);/m,
    'o card de fundo não ganha o mesmo aperto — a promessa do que vem mudaria de forma ao virar o card real');
  assert.ok(fundo.indexOf('stack.appendChild(fundo)') < fundo.indexOf('vigiarBarraDeAcoes(fundo)'),
    'a vigia do card de fundo roda ANTES de ele estar no documento: a medida sairia zero');
});

test('R19-8-01 · o CSS: a foto cede até 5.5rem, o piso do texto sai, e só dentro do `card-aperta`', () => {
  const bloco = (re) => { const m = re.exec(CSS_SEM); assert.ok(m, 'regra sumiu: ' + re); return m[0]; };
  assert.match(bloco(/\.place-card\.card-aperta \.card-photo \{[^}]*\}/), /min-height:\s*5\.5rem/,
    'o piso da foto no card-aperta não é 5.5rem');
  assert.match(bloco(/\.place-card\.card-aperta \.card-content:not\(:has\(\.card-changes:not\(\.hidden\), \.card-flag-comment:not\(\.hidden\)\)\) \{[^}]*\}/),
    /min-height:\s*0/);
  // Deitado o card é GRADE (a foto na coluna ao lado, piso 0): o `card-aperta`
  // não pode LEVANTAR o piso da foto ali — o override vem DEPOIS da regra geral.
  const geral = CSS_SEM.indexOf('.place-card.card-aperta .card-photo {');
  // O override mora DENTRO do degrau de paisagem que já existia (os guards do
  // degrau leem a PRIMEIRA ocorrência do @media: uma duplicata acima os desviava).
  const deitado = CSS_SEM.indexOf('.place-card.card-aperta .card-photo {', geral + 10);
  assert.ok(geral > 0 && deitado > geral, 'o card-aperta levanta o piso da foto também deitado (grade)');
  assert.ok(CSS_SEM.slice(CSS_SEM.lastIndexOf('@media', deitado)).startsWith('@media (max-height: 480px) and (min-width: 560px) {'),
    'o override do deitado não está no degrau de paisagem');
  assert.match(CSS_SEM.slice(deitado, deitado + 120), /min-height:\s*0/);
  // 1× nada muda: nenhuma regra solta (sem o `card-aperta`) pode ter sido mexida
  // pra esta correção. O piso da foto de fábrica segue no HTML e os degraus por
  // altura seguem como estavam.
  assert.match(HTML, /card-photo grow shrink-\[30\] basis-0 min-h-\[9rem\] max-h-\[55%\]/, 'o piso de fábrica da foto mudou');
  assert.match(CSS_SEM, /@media \(max-height: 700px\) \{[\s\S]*?\.place-card \.card-photo \{\s*min-height:\s*7rem;/);
});

test('R19-8-01 · o piso do #cardStack é o 26rem de sempre, com teto em 60dvh só pra escala maior', () => {
  const piso = CSS_SEM.match(/@media \(min-height: 700px\) \{\s*#cardStack \{[^}]*\}/);
  assert.ok(piso, 'o degrau do piso do #cardStack sumiu');
  assert.match(piso[0], /min-height:\s*26rem;\s*min-height:\s*min\(26rem,\s*60dvh\)/,
    'o piso perdeu o teto de 60dvh (ou a reserva de 26rem pro navegador sem dvh)');
  // A conta que garante o "nada muda a 1×": a partir de 700 px, 60% da altura é
  // 420 px ou mais — acima dos 416 px de 26rem em escala 1.
  assert.ok(0.6 * 700 >= 26 * 16, '60dvh nos 700 px do degrau ficou abaixo de 26rem: o piso de hoje mudaria');
});

// ═══ R19-8-02 · texto do Waze em hebraico/árabe ══════════════════════════════
test('R19-8-02 · todo elemento do template que recebe texto do Waze leva dir="auto"', () => {
  const tpl = HTML.slice(HTML.indexOf('<template id="cardTemplate">'), HTML.indexOf('</template>', HTML.indexOf('<template id="cardTemplate">')));
  // A classe se acha pela LISTA (`card-category` casaria `card-category-row` por
  // `\\b`: o hífen é fronteira de palavra).
  const tagDa = (cls) => (tpl.match(/<[a-z0-9]+ [^>]*>/g) || []).find((tag) => {
    const lista = /class="([^"]*)"/.exec(tag);
    return lista && lista[1].split(/\s+/).includes(cls);
  });
  for (const cls of ['card-name', 'card-category', 'card-address', 'card-creator', 'card-brand',
    'card-flag-reason-value', 'card-flag-comment-text']) {
    const tag = tagDa(cls);
    assert.ok(tag, `o elemento .${cls} sumiu do template`);
    assert.match(tag, /\bdir="auto"/, `.${cls} recebe texto do Waze e não leva dir="auto"`);
  }
  // O que é NOSSO não leva: o tipo e a idade.
  for (const cls of ['card-type', 'card-age']) {
    const tag = tagDa(cls);
    assert.ok(tag, `.${cls} sumiu do template`);
    assert.doesNotMatch(tag, /\bdir=/, `.${cls} é texto do app e ganhou dir`);
  }
  // Nenhum texto do app é alinhado com `text-left` físico nesses elementos.
  assert.doesNotMatch(tpl, /class="card-(name|address|creator|brand)[^"]*text-left/);
});

test('R19-8-02 · as outras telas com texto do Waze: nome na foto, autor, conversa', () => {
  const tag = (id) => { const m = HTML.match(new RegExp('<[a-z0-9]+ id="' + id + '"[^>]*>')); assert.ok(m, `#${id} sumiu`); return m[0]; };
  for (const id of ['lightboxNomeTxt', 'lightboxNomeInput', 'autorTitle', 'conversaTitle', 'conversaAnexoNome', 'conversaInput']) {
    assert.match(tag(id), /\bdir="auto"/, `#${id} mostra/recebe texto de pessoa e não leva dir="auto"`);
  }
});

test('R19-8-02 · o JS que monta HTML com texto do Waze leva dir="auto" (diff e conversa)', () => {
  const renderMudancas = fatiar('renderCardChanges');
  // TODA célula de valor do diff (de/para, cru ou realçado, e o item de lista).
  const celulas = renderMudancas.match(/<span class="diff-(from|to)"[^>]*>/g) || [];
  assert.ok(celulas.length >= 6, `esperava as 6 células de/para do diff e achei ${celulas.length}`);
  for (const c of celulas) assert.match(c, /dir="auto"/, `célula do diff sem dir="auto": ${c}`);
  assert.match(fatiar('itemDeLista'), /<span class="\$\{cls\}" dir="auto">/, 'o item de lista do diff perdeu o dir="auto"');
  // A conversa (presenca.js).
  for (const [re, quem] of [
    [/<span dir="auto" class="presenca-nome">/g, 'o nome na lista'],
    // A prévia de TEXTO de gente leva `dir="auto"`; a MONTADA pelo app (📍 nome · tipo) fica na direção do app
    // com o nome isolado (R20-5-06, `presenca-auditoria-r20.test.mjs`).
    [/<span\$\{montada \? '' : ' dir="auto"'\} class="presenca-l2\$\{n \? ' forte' : ''\}">/g, 'a prévia da conversa'],
    [/<div dir="auto" class="conversa-bolha \$\{m\.meu/g, 'a bolha'],
    [/<span dir="auto" class="cp-nome">/g, 'o nome do pedido mandado'],
    [/<span id="\$\{desc\}" dir="auto" class="cp-legenda">/g, 'a pergunta do pedido mandado'],
  ]) {
    assert.ok(re.test(SEM_PRESENCA), `${quem} perdeu o dir="auto"`);
  }
  assert.equal((SEM_PRESENCA.match(/dir="auto" class="presenca-nome"/g) || []).length, 2, 'as DUAS linhas (online e conversa) levam o nome com dir="auto"');
});

test('R19-8-02 · `text-align: left` físico não fica herdado pelo texto do Waze', () => {
  // TODAS as regras do seletor (o `.lb-nome-btn` tem várias; só uma alinha).
  const regras = (sel) => [...CSS_SEM.matchAll(new RegExp('(?:^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{[^}]*\\}', 'g'))].map((m) => m[0]);
  for (const sel of ['.presenca-linha', '.conversa-pedido', '.lb-nome-btn']) {
    const todas = regras(sel);
    assert.ok(todas.length, sel + ' sumiu');
    for (const r of todas) assert.doesNotMatch(r, /text-align:\s*left/, `${sel} fixa text-align: left e o texto em hebraico herdaria o alinhamento à esquerda`);
    assert.ok(todas.some((r) => /text-align:\s*start/.test(r)), `${sel} deveria alinhar em \`start\``);
  }
});

test('R19-8-02 · `isolarTextoDoWaze`: texto da esquerda pra direita sai idêntico; o da direita pra esquerda, isolado', () => {
  const corpo = constante('LETRA_DA_DIREITA_PRA_ESQUERDA') + '\n' + fatiar('isolarTextoDoWaze');
  const isolar = new Function(corpo + '\nreturn isolarTextoDoWaze;')();
  for (const ltr of ['Padaria Pão Quente', 'Zé (filial 2)', '', null, undefined, 'Café 24h – Centro', '東京タワー']) {
    assert.equal(isolar(ltr), String(ltr == null ? '' : ltr), `texto da esquerda pra direita foi alterado: ${ltr}`);
  }
  for (const rtl of ['מסעדת השף – הנמל 12 (סניף 2)', 'مطعم الأصالة (فرع 2)', 'Café שלום', 'ܐܒܓ', 'ހަތް']) {
    const r = isolar(rtl);
    assert.equal(r, '\u2068' + rtl + '\u2069', `o texto da direita pra esquerda não foi isolado: ${rtl}`);
  }
});

test('R19-8-02 · o nome do local duplicado entra isolado na frase', () => {
  assert.match(fatiar('montarCard'), /t\('card\.flagDuplicateOf', \{ alvo: isolarTextoDoWaze\(place\.duplicado\.nome\) \}\)/,
    'o nome do duplicado vai cru no meio da frase');
});


// ═══ R19-8-03 · o aviso do Desfazer troca de idioma sem reiniciar a janela ═══
function montarAviso(chave, vars) {
  const dict = { pt: { 'undo.reject': 'Pedido rejeitado', 'undo.lote': '{n} pedidos', 'undo.button': 'Desfazer' },
    en: { 'undo.reject': 'Request rejected', 'undo.lote': '{n} requests', 'undo.button': 'Undo' } };
  let lang = 'pt';
  const t = (k, v) => String(dict[lang][k]).replace(/\{(\w+)\}/g, (_, x) => (v && x in v ? v[x] : `{${x}}`));
  const progresso = { nome: 'undo-progress' };
  const botao = { textContent: 'Desfazer' };
  const frase = { textContent: 'Pedido rejeitado' };
  const banner = {
    dataset: {}, firstElementChild: frase,
    querySelector: (s) => (s === '#undoBtn' ? botao : null),
    children: [frase, botao, progresso],
  };
  const container = { querySelector: (s) => (s === '.undo-banner' ? banner : null) };
  const document = { getElementById: (id) => (id === 'undoContainer' ? container : null) };
  const funcs = new Function('t', 'document', fatiar('marcarFraseDoDesfazer') + '\n' + fatiar('retraduzirAvisoDoDesfazer')
    + '\nreturn { marcarFraseDoDesfazer, retraduzirAvisoDoDesfazer };')(t, document);
  funcs.marcarFraseDoDesfazer(banner, chave, vars);
  return { banner, frase, botao, progresso, ...funcs, trocar: (l) => { lang = l; } };
}

test('R19-8-03 · trocar o idioma na janela reescreve a frase e o botão, sem refazer o banner', () => {
  const m = montarAviso('undo.reject', null);
  m.trocar('en');
  m.retraduzirAvisoDoDesfazer();
  assert.equal(m.frase.textContent, 'Request rejected');
  assert.equal(m.botao.textContent, 'Undo');
  assert.deepEqual(m.banner.children, [m.frase, m.botao, m.progresso],
    'o banner foi refeito: a barra de contagem reiniciaria e a janela deixaria de bater com ela');
});

test('R19-8-03 · a frase com variável (o lote) volta com o número', () => {
  const m = montarAviso('undo.lote', { n: 7 });
  m.trocar('en');
  m.retraduzirAvisoDoDesfazer();
  assert.equal(m.frase.textContent, '7 requests');
});

test('R19-8-03 · sem banner, ou com banner de frase que não é uma chave, não faz nada', () => {
  const m = montarAviso('undo.reject', null);
  delete m.banner.dataset.chave;
  m.trocar('en');
  m.retraduzirAvisoDoDesfazer();
  assert.equal(m.frase.textContent, 'Pedido rejeitado');
});

test('R19-8-03 · o `aplicarIdioma` chama a retradução, e os dois bancos de aviso marcam a frase', () => {
  assert.match(fatiar('aplicarIdioma'), /^\s*retraduzirAvisoDoDesfazer\(\);/m, 'o aplicarIdioma não retraduz o aviso do Desfazer');
  assert.match(fatiar('showUndoBanner'), /marcarFraseDoDesfazer\(banner, chave, vars\)/, 'o aviso do card não lembra qual frase é');
  assert.match(fatiar('mostrarDesfazer'), /marcarFraseDoDesfazer\(banner, chave, vars\)/, 'o aviso da foto não lembra qual frase é');
  const agenda = fatiar('scheduleAction');
  assert.match(agenda, /showUndoBanner\(t\(undoChave, undoVars \|\| undefined\), undoChave, undoVars\)/,
    'o aviso do card é escrito sem a chave');
  for (const k of ['undo.photoDeleted', 'undo.photoApproved', 'undo.renamed']) {
    assert.ok(new RegExp(`mostrarDesfazer\\(t\\('${k.replace('.', '\\.')}'[^\\n]*, '${k.replace('.', '\\.')}'`).test(SEM),
      `o aviso ${k} da foto é escrito sem a chave`);
  }
  // A chave existe nas 4 línguas (a paridade completa é do i18n.test).
  for (const k of ['undo.reject', 'undo.skip', 'undo.read', 'undo.lote', 'undo.button', 'undo.photoDeleted']) {
    assert.equal((I18N.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length, 4, `${k} não está nas 4 línguas`);
  }
});
