// Lote 25 — histórico, Resumo do mês, placar e Ajuda (rodada 21 da auditoria, R21-7).
//
//   R21-7-02  o NOME da pessoa na imagem do Resumo se lê na direção dele (hebraico, árabe)
//   R21-7-03  o `alt` e o título da folha do Resumo não ficam no DOM depois de fechar
//   R21-7-04  os números do Histórico dizem a quem pertencem (lidos × rejeitados)
//   D2        o aviso "Sua sessão vence em N dias" também refaz a medida do placar
//   texto     o botão do Histórico não promete "Compartilhar" onde só há "Baixar"
//   (e)       conquistas guardadas com `c`/`n` em lista não somem a cada carga
//
// O app.js é script de browser, não módulo: os testes FATIAM a fonte e executam a
// função num escopo de mentira (o padrão de test/resumo.test.mjs). O que só o
// navegador responde — a ORDEM em que o canvas desenha um texto bidirecional, o
// `ariaSnapshot`, o placar de verdade — está em tools/smoke-browser.mjs, nos
// blocos "lote 25".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const APP = ler('js/app.js');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e o comentário se tira por LINHA.
const SEM = APP.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// A função inteira: do `function nome(` até o `}` de coluna 0 que a fecha. Âncora
// em DECLARAÇÃO, nunca em distância (gotcha #67); e o instrumento confere que não
// devolveu nada (um corpo curto demais é fatiador quebrado, não função pequena).
function fatiar(nome, fonte = SEM) {
  const m = new RegExp('^(?:async )?function ' + nome + '\\(', 'm').exec(fonte);
  assert.ok(m, `a função ${nome} sumiu do app.js`);
  const fim = fonte.indexOf('\n}\n', m.index);
  assert.ok(fim > 0, `não consegui delimitar ${nome}`);
  const corpo = fonte.slice(m.index, fim + 2);
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} caracteres — o instrumento quebrou`);
  return corpo;
}
// A constante de topo, de uma declaração só (termina em `;` no fim da linha).
function constante(nome, fonte = SEM) {
  const m = new RegExp('^const ' + nome + ' = [^\\n]*;\\n', 'm').exec(fonte);
  assert.ok(m, `a constante ${nome} sumiu do app.js`);
  return m[0];
}

// O dicionário de VERDADE (pt/en/es/fr), com `t()` e `setLang()`.
const I18N = new Function('window', 'navigator', 'localStorage', 'document',
  ler('js/i18n.js') + '\nreturn { t, setLang };')(
  {}, { language: 'pt-BR' }, { getItem: () => null, setItem() {} }, { documentElement: {}, querySelectorAll: () => [] });

// ═══ R21-7-02 · o nome da pessoa na imagem do Resumo ═══════════════════════════════════════════════
//
// `{nome} limpou` era uma string só, desenhada com a direção do app: o nome em
// hebraico ou árabe, com pontuação ou número, saía na ordem errada NA IMAGEM
// QUE A PESSOA COMPARTILHA ("(IL) مرحبا" saía "مرحبا (IL)"), enquanto o mesmo nome
// no DOM (`dir="auto"`) já saía certo. O canvas não decide a direção sozinho:
// ela se pede (`ctx.direction`).
const AJUDANTES_DO_NOME = ['LETRA_DA_DIREITA_PRA_ESQUERDA', 'LETRA_DE_QUALQUER_ALFABETO', 'LETRA_DA_ESQUERDA_PRA_DIREITA',
  'MARCA_DO_NOME_NA_FRASE'].map((n) => constante(n)).join('')
  + ['isolarTextoDoWaze', 'direcaoDoTextoDoWaze', 'partesDoNomeNaFrase'].map((n) => fatiar(n)).join('\n') + '\n';

function nomeDoResumo(tReal = I18N.t) {
  return new Function('t', AJUDANTES_DO_NOME + 'return { isolarTextoDoWaze, direcaoDoTextoDoWaze, partesDoNomeNaFrase };')(tReal);
}
const { direcaoDoTextoDoWaze, partesDoNomeNaFrase } = nomeDoResumo();

// Os cinco nomes da auditoria, o controle da esquerda pra direita e os que MISTURAM alfabetos.
const NOMES = {
  hebraicoComNumero: 'משה (2)', hebraico: 'שרה', arabeComLatim: 'مرحبا (IL)', latim: 'Avi_Cohen', hebraicoComTudo: 'דני [IL] 12',
  latimPrimeiro: 'moshe משה', latimPrimeiroArabe: 'Ahmed أحمد (IL)', numeroPrimeiro: '12 שרה', parentesePrimeiro: '(שרה)',
  hebraicoELatim: 'ירון-IL', hebraicoComSublinhado: 'דני_dan12',
};

test('R21-7-02 · a direção do nome é a da primeira letra FORTE — como o `dir="auto"` do DOM, e não "tem uma letra hebraica"', () => {
  const rtl = ['משה (2)', 'שרה', 'مرحبا (IL)', 'דני [IL] 12', '12 שרה', '(שרה)', '٣٤ مرحبا', '[2] דני', 'ירון-IL', 'ܐܒܓ', 'ހަތް'];
  const ltr = ['Avi_Cohen', 'moshe משה', 'Ahmed أحمد (IL)', 'Zé (filial 2)', '東京タワー', 'world_12345', '12345', '(2)', '', null, undefined];
  for (const n of rtl) assert.equal(direcaoDoTextoDoWaze(n), 'rtl', `"${n}" começa em hebraico/árabe e devia ler da direita pra esquerda`);
  for (const n of ltr) assert.equal(direcaoDoTextoDoWaze(n), 'ltr', `"${n}" devia ler da esquerda pra direita`);
  // CONTROLE: a regra "tem uma letra da direita pra esquerda" (a do isolamento) JÁ casa nos dois nomes mistos
  // que começam em latim — é ela que desenharia "משה moshe" onde o cabeçalho mostra "moshe משה".
  const { isolarTextoDoWaze } = nomeDoResumo();
  assert.notEqual(isolarTextoDoWaze('moshe משה'), 'moshe משה', 'CONTROLE: a regra do isolamento devia casar no nome misto');
  assert.equal(direcaoDoTextoDoWaze('moshe משה'), 'ltr');
});

test('R21-7-02 · a frase em pedaços: antes + nome + depois é a frase do idioma, nos 4 — e nome da esquerda pra direita não vira pedaços', () => {
  for (const lang of ['pt', 'en', 'es', 'fr']) {
    I18N.setLang(lang);
    try {
      for (const nome of [NOMES.hebraicoComNumero, NOMES.hebraico, NOMES.hebraicoELatim, NOMES.hebraicoComSublinhado]) {
        const partes = partesDoNomeNaFrase(nome);
        assert.ok(Array.isArray(partes), `${lang}: "${nome}" devia sair em pedaços`);
        assert.equal(partes.map(([s]) => s).join(''), I18N.t('resumo.img.limpou', { nome }), `${lang}: os pedaços não refazem a frase`);
        // SÓ o nome é da direita pra esquerda; a frase em volta segue a direção do app (`null` = a do contexto).
        assert.deepEqual(partes.map(([, d]) => d), partes.map(([s]) => (s === nome ? 'rtl' : null)), `${lang}: a direção dos pedaços`);
        assert.ok(partes.every(([s]) => s !== ''), `${lang}: pedaço vazio (uma chamada à toa)`);
      }
      for (const nome of [NOMES.latim, NOMES.latimPrimeiro, NOMES.latimPrimeiroArabe, 'José Álvarez', '東京タワー', '']) {
        assert.equal(partesDoNomeNaFrase(nome), null, `${lang}: "${nome}" se lê da esquerda pra direita e não devia virar pedaços`);
      }
    } finally { I18N.setLang('pt'); }
  }
});

test('R21-7-02 · a posição do `{nome}` é da TRADUÇÃO: com ele no meio ou no fim da frase os pedaços seguem a ordem dela', () => {
  const dicionario = { 'resumo.img.limpou': 'Hoje {nome} limpou' };
  const tFalso = (k, v) => String(dicionario[k]).replace(/\{(\w+)\}/g, (_, x) => String(v[x]));
  const { partesDoNomeNaFrase: partes } = nomeDoResumo(tFalso);
  assert.deepEqual(partes('שרה'), [['Hoje ', null], ['שרה', 'rtl'], [' limpou', null]]);
  dicionario['resumo.img.limpou'] = 'Feito por {nome}';
  assert.deepEqual(partes('שרה'), [['Feito por ', null], ['שרה', 'rtl']], 'o nome no fim: sem pedaço depois');
  dicionario['resumo.img.limpou'] = '{nome}';
  assert.deepEqual(partes('שרה'), [['שרה', 'rtl']], 'só o nome');
  dicionario['resumo.img.limpou'] = 'sem marca nenhuma';   // dicionário sem o `{nome}`: não inventa nada
  assert.equal(partes('שרה'), null, 'sem o `{nome}` na frase não há como cortar: a linha inteira se desenha de uma vez');
});

test('R21-7-02 · nome da direita pra esquerda que MISTURA alfabetos e tem colchete só é ISOLADO (o canvas do WebKit parte o par com `rtl`)', () => {
  // MEDIDO nos dois motores (Chromium 156 e o WebKit 27.2 do Linux, relatório do lote 25): no WebKit, com
  // `direction = 'rtl'`, o par sai partido ("IL] 12 [ דני"); no Chromium o isolamento sozinho acerta, e no
  // WebKit ele não muda nada — daí o nome ficar só isolado, sem forçar a direção.
  for (const nome of [NOMES.hebraicoComTudo, NOMES.arabeComLatim, 'דני (Dan) 3', 'דני [IL]12', '(דני) Dan 3']) {
    assert.equal(partesDoNomeNaFrase(nome), null, `"${nome}" mistura alfabetos e tem colchete: devia ir só isolado`);
  }
  // CONTROLES: sem colchete, ou sem mistura, o `rtl` é o caminho (nomes de usuário reais não têm colchete).
  for (const nome of ['דני IL 12', 'ירון-IL', 'דני_dan12', 'משה (2)', '(שרה)', 'שרה [2]']) {
    assert.ok(partesDoNomeNaFrase(nome), `CONTROLE: "${nome}" devia sair em pedaços (sem mistura ou sem colchete)`);
  }
});

// Um contexto de canvas de mentira: guarda cada `fillText` com a direção NA HORA em que foi chamado.
function canvasDeMentira() {
  const chamadas = [];
  const ctx = {
    direction: 'inherit', letterSpacing: '0px', font: '', fillStyle: '', textAlign: '', textBaseline: '', lineWidth: 0, strokeStyle: '',
    beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, fill() {}, stroke() {}, fillRect() {}, save() {}, restore() {}, clip() {},
    drawImage() {}, createRadialGradient: () => ({ addColorStop() {} }),
    fillText(s, x, y) { chamadas.push({ s, x, y, direction: ctx.direction, textAlign: ctx.textAlign }); },
    measureText: (s) => ({ width: [...String(s)].length * 10 }),
  };
  return { ctx, chamadas };
}
const DESENHO = new Function('RESUMO_LARGURA', 'RESUMO_ALTURA', fatiar('desenharResumo') + '\nreturn desenharResumo;')(1080, 1350);
const TEXTOS = new Function('t', AJUDANTES_DO_NOME + fatiar('textosDoResumo') + '\nreturn textosDoResumo;')(I18N.t);
const MES = { ano: 2026, mesIdx: 9, diasNoMes: 31, total: 50, lidos: 30, rejeitados: 20, diasAtivos: 1, forte: { dia: 5, n: 50 },
  serie: new Array(31).fill(0).map((_, i) => (i === 4 ? 50 : 0)) };
function desenhar(nome, { semPropriedade = false } = {}) {
  const { ctx, chamadas } = canvasDeMentira();
  if (semPropriedade) delete ctx.direction;
  const { tx } = TEXTOS(MES, { userName: nome, rank: 5, isAreaManager: true }, 'pt-BR');
  DESENHO(ctx, MES, tx, {});
  return { ctx, chamadas, tx, linha: chamadas.filter((c) => c.y === 232) };
}

test('R21-7-02 · o desenho: o nome da direita pra esquerda sai À PARTE com `rtl`, a frase depois dele sem `rtl`, e a direção VOLTA', () => {
  const r = desenhar(NOMES.hebraicoComNumero);
  assert.deepEqual(r.linha.map((c) => [c.s, c.direction]), [['משה (2)', 'rtl'], [' limpou', 'inherit']],
    'a linha do nome devia ter o nome com `rtl` e a frase na direção do contexto');
  assert.equal(r.linha[0].x, 80, 'o nome começa em PAD');
  assert.equal(r.linha[1].x, 80 + [...'משה (2)'].length * 10, 'a frase começa onde o nome TERMINA (a largura medida do nome)');
  assert.equal(r.linha.every((c) => c.textAlign === 'left'), true, 'o alinhamento é o físico: `rtl` + `start` mudaria de onde o texto começa');
  assert.equal(r.ctx.direction, 'inherit', 'a direção ficou `rtl` no contexto: o resto da imagem (o número, o rodapé) herdaria');
  assert.ok(r.chamadas.filter((c) => c.y !== 232).every((c) => c.direction === 'inherit'), 'outro texto da imagem foi desenhado com `rtl`');
});

test('R21-7-02 · o desenho: nome da esquerda pra direita é UMA chamada, sem `rtl` — a linha de sempre', () => {
  for (const nome of [NOMES.latim, 'José Álvarez', NOMES.latimPrimeiro, NOMES.latimPrimeiroArabe]) {
    const r = desenhar(nome);
    assert.equal(r.linha.length, 1, `"${nome}": a linha virou ${r.linha.length} chamadas`);
    assert.equal(r.linha[0].s, r.tx.limpou);
    assert.equal(r.linha[0].direction, 'inherit', `"${nome}": desenhado com a direção mexida`);
    assert.equal(r.linha[0].s, I18N.t('resumo.img.limpou', { nome }), `"${nome}": a string desenhada não é a de sempre (byte a byte)`);
  }
  // O nome do guard (mistura + colchete) vai numa chamada só, ISOLADO — e sem `rtl`.
  const g = desenhar(NOMES.hebraicoComTudo);
  assert.equal(g.linha.length, 1);
  assert.equal(g.linha[0].s, '⁨דני [IL] 12⁩ limpou');
  assert.equal(g.linha[0].direction, 'inherit');
});

test('R21-7-02 · motor sem `ctx.direction`: o nome sai como sempre saiu (em pedaços, sem erro e sem inventar a propriedade)', () => {
  const r = desenhar(NOMES.hebraicoComNumero, { semPropriedade: true });
  assert.deepEqual(r.linha.map((c) => c.s), ['משה (2)', ' limpou']);
  assert.equal('direction' in r.ctx, false, 'o desenho criou `ctx.direction` num motor que não tem');
});

test('R21-7-02 · o texto da imagem: LTR igual byte a byte; o da direita pra esquerda isolado na frase (e no `alt`)', () => {
  for (const nome of [NOMES.latim, 'José Álvarez', NOMES.latimPrimeiro, NOMES.latimPrimeiroArabe, '東京タワー', 'world_12345']) {
    const { tx, alt } = TEXTOS(MES, { userName: nome, rank: 5, isAreaManager: true }, 'pt-BR');
    assert.equal(tx.limpou, `${nome} limpou`, `"${nome}": a frase mudou`);
    assert.equal(tx.limpouPartes, null, `"${nome}": ganhou pedaços`);
    assert.ok(alt.includes(`${nome} limpou 50 pedidos do mapa`), `"${nome}": o alt mudou`);
  }
  for (const nome of [NOMES.hebraicoComNumero, NOMES.hebraico, NOMES.arabeComLatim, NOMES.hebraicoComTudo]) {
    const { tx, alt } = TEXTOS(MES, { userName: nome, rank: 5, isAreaManager: true }, 'pt-BR');
    assert.equal(tx.limpou, `⁨${nome}⁩ limpou`, `"${nome}": o nome não foi isolado na frase`);
    assert.ok(alt.includes(`⁨${nome}⁩ limpou 50 pedidos do mapa`), `"${nome}": o alt traz o nome sem isolar`);
  }
  // Sem perfil (a abertura com sinal ruim): nenhuma das duas linhas, como antes.
  const sem = TEXTOS(MES, null, 'pt-BR').tx;
  assert.equal(sem.limpou, '');
  assert.equal(sem.limpouPartes, null);
});

test('R21-7-02 (estrutura): o desenho segue sem `t()` e sem `toLocale`, e a direção só entra pelo `texto()` que a restaura', () => {
  const desenho = fatiar('desenharResumo');
  assert.doesNotMatch(desenho, /\bt\(/, 'desenharResumo chama t() — o texto chega pronto');
  assert.doesNotMatch(desenho, /toLocale/);
  // Toda escrita de `ctx.direction` mora no `texto()` (que guarda e devolve o valor): fora dele a direção vazaria.
  const escritas = desenho.match(/ctx\.direction\s*=[^=]/g) || [];
  assert.equal(escritas.length, 2, 'esperava duas escritas de ctx.direction (pedir e devolver), ambas no `texto()`');
  const texto = desenho.slice(desenho.indexOf('const texto ='), desenho.indexOf('const cartao ='));
  assert.equal((texto.match(/ctx\.direction\s*=[^=]/g) || []).length, 2, 'a direção é escrita fora do `texto()`');
  assert.match(texto, /ctx\.direction = direcaoAntes/, 'o `texto()` não devolve a direção que encontrou');
});

// ═══ R21-7-03 · o `alt` e o título da folha do Resumo depois de fechar ═════════════════════════════
//
// O `alt` da imagem traz o NOME da pessoa e os números do mês; a limpeza do fechamento soltava o blob
// e o `src` e deixava o resto. Ele ficava no DOM da folha fechada e depois do "Sair", e o relatório do
// modo dev leva o DOM inteiro. O que o navegador responde (os quatro caminhos de fechar e o "Sair" de
// verdade) está no bloco "o `alt` da imagem não sobra" do smoke de layout.
function limpezaDoResumo() {
  const objeto = (/const LIMPEZA_AO_FECHAR = \{([\s\S]*?)\n\};/.exec(SEM) || [])[1];
  assert.ok(objeto, 'LIMPEZA_AO_FECHAR sumiu do app.js');
  const corpo = (/\n    resumoModal\(\) \{([\s\S]*?)\n    \},/.exec(objeto) || [])[1];
  assert.ok(corpo && corpo.length > 40, 'resumoModal não tem limpeza em LIMPEZA_AO_FECHAR');
  return corpo;
}
function folhaDeMentira({ comTitulo = true, comImagem = true } = {}) {
  const ids = [], soltos = [];
  const img = { _attrs: { alt: 'EditorSecreto limpou 25 pedidos do mapa. 5 rejeitados, 20 lidos.', src: 'blob:http://x/1' },
    get src() { return this._attrs.src || ''; },
    removeAttribute(a) { delete this._attrs[a]; }, setAttribute(a, v) { this._attrs[a] = String(v); } };
  const titulo = { textContent: 'Seu resumo de outubro' };
  const document = { getElementById: (id) => { ids.push(id); return id === 'resumoImg' && comImagem ? img : id === 'resumoTitle' && comTitulo ? titulo : null; } };
  const URLFalsa = { revokeObjectURL: (u) => soltos.push(u) };
  const resumoAtualDepois = new Function('document', 'URL', 'let resumoAtual = { blob: {}, nome: "x.png", mesNome: "outubro" };\n'
    + '(function () {' + limpezaDoResumo() + '\n})();\nreturn resumoAtual;')(document, URLFalsa);
  return { img, titulo, ids, soltos, resumoAtualDepois };
}

test('R21-7-03 · fechar a folha do Resumo devolve o `alt` e o título ao que o HTML entrega, e solta o blob', () => {
  const f = folhaDeMentira();
  assert.equal(f.img._attrs.alt, '', 'DEFEITO: o `alt` — o nome da pessoa e os números do mês — ficou no DOM da folha fechada');
  assert.equal(f.titulo.textContent, '', 'o título da folha (o mês) ficou depois de fechar');
  assert.equal('src' in f.img._attrs, false, 'o `src` (o object URL) ficou');
  assert.deepEqual(f.soltos, ['blob:http://x/1'], 'o object URL não foi solto');
  assert.equal(f.resumoAtualDepois, null, 'o blob da imagem seguiu na memória');
  // A limpeza só mexe nos DOIS elementos da folha.
  assert.deepEqual([...new Set(f.ids)].sort(), ['resumoImg', 'resumoTitle']);
});

test('R21-7-03 · CONTROLE: sem a imagem ou sem o título na página a limpeza não lança', () => {
  assert.doesNotThrow(() => folhaDeMentira({ comImagem: false }));
  assert.doesNotThrow(() => folhaDeMentira({ comTitulo: false }));
  assert.doesNotThrow(() => folhaDeMentira({ comImagem: false, comTitulo: false }));
});

test('R21-7-03 (estrutura): limpar não deixa a folha ABERTA sem texto — a abertura reescreve o `alt` e o título', () => {
  const abrir = fatiar('abrirResumoDoMes');
  assert.match(abrir, /img\.alt = r\.alt \|\|/, 'a abertura não escreve o `alt` com os números');
  assert.match(abrir, /getElementById\('resumoTitle'\)\.textContent = t\('resumo\.modal\.title'/, 'a abertura não escreve o título');
  // E o HTML entrega os dois vazios (é a ele que a limpeza devolve a folha).
  const html = ler('index.src.html');
  assert.match(html, /<img id="resumoImg" alt=""/, 'o HTML deixou de entregar o `alt` vazio');
  assert.match(html, /<h3 id="resumoTitle"[^>]*><\/h3>/, 'o HTML deixou de entregar o título vazio');
});
