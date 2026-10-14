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

// ═══ R21-7-04 · os números do Histórico dizem a quem pertencem ═══════════════════════════════════
//
// Cada linha da tabela (Hoje, Semana, Mês, Total) era `<span>12</span> · <span>3</span>`: sem rótulo, e só
// a cor (verde e rosa) separava lidos de rejeitados — o cabeçalho "Lidos Rejeitados" mora ANTES da patente,
// longe da tabela, e o leitor de tela ouvia "Hoje 12 · 3". Agora uma frase `sr-only` fala por eles
// ("12 lidos, 3 rejeitados") e os números da tela saem da árvore de acessibilidade (`aria-hidden`).
// `aria-label` num `<span>` não resolveria: o papel genérico não tem nome. O visual é o mesmo, pixel por
// pixel (medido: bloco "os números do Histórico dizem a quem pertencem" do smoke de layout).
const FRASES = {
  pt: { '12,3': '12 lidos, 3 rejeitados', '1,3': '1 lido, 3 rejeitados', '12,1': '12 lidos, 1 rejeitado', '1,1': '1 lido, 1 rejeitado', '0,0': '0 lidos, 0 rejeitados' },
  en: { '12,3': '12 read, 3 rejected', '1,3': '1 read, 3 rejected', '12,1': '12 read, 1 rejected', '1,1': '1 read, 1 rejected', '0,0': '0 read, 0 rejected' },
  es: { '12,3': '12 leídas, 3 rechazadas', '1,3': '1 leída, 3 rechazadas', '12,1': '12 leídas, 1 rechazada', '1,1': '1 leída, 1 rechazada', '0,0': '0 leídas, 0 rechazadas' },
  fr: { '12,3': '12 lues, 3 rejetées', '1,3': '1 lue, 3 rejetées', '12,1': '12 lues, 1 rejetée', '1,1': '1 lue, 1 rejetée', '0,0': '0 lues, 0 rejetées' },
};
const fraseDoPar = new Function('t', fatiar('fraseDosLidosERejeitados') + '\nreturn fraseDosLidosERejeitados;')(I18N.t);

test('R21-7-04 · a frase dos dois números: plural POR CHAVE (1 é o caso comum) nos 4 idiomas', () => {
  for (const [lang, casos] of Object.entries(FRASES)) {
    I18N.setLang(lang);
    try {
      for (const [par, esperado] of Object.entries(casos)) {
        const [lidos, rejeitados] = par.split(',').map(Number);
        assert.equal(fraseDoPar(lidos, rejeitados), esperado, `${lang}: ${par}`);
      }
      // Um conceito, um nome: as palavras são as dos rótulos do placar ("Lidos Rejeitados", "Leídas Rechazadas"…).
      const lidos = I18N.t('stats.read').toLowerCase(), rejeitados = I18N.t('stats.rejected').toLowerCase();
      assert.ok(fraseDoPar(2, 2).includes(` ${lidos},`) && fraseDoPar(2, 2).endsWith(` ${rejeitados}`),
        `${lang}: a frase não usa as palavras do placar ("${lidos}", "${rejeitados}")`);
    } finally { I18N.setLang('pt'); }
  }
});

// `renderHistory` DE VERDADE, com o DOM de mentira de uma raiz só (a tabela é o que interessa).
function linhasDoHistorico({ lang = 'pt', stats }) {
  const el = { innerHTML: '', dataset: { conqLigado: '1' }, appendChild() {}, insertAdjacentHTML() {}, contains: () => false };
  const document = { getElementById: (id) => (id === 'historyBody' ? el : null), activeElement: null };
  const deps = { document, getHistoryStats: () => stats, renderAutores() {}, chaveDoFoco: () => null, devolverFocoAoPainel() {},
    htmlPatente: () => '', htmlConquistas: () => '', dadosDoResumo: () => ({ total: 0 }), loadHistory: () => ({}), i18nLocale: () => 'pt-BR',
    ligarConquistas() {}, abrirResumoDoMes() {}, t: I18N.t, escapeHtml: new Function(fatiar('escapeHtml') + '\nreturn escapeHtml;')() };
  const chaves = Object.keys(deps);
  const roda = new Function(...chaves, fatiar('fraseDosLidosERejeitados') + '\n' + fatiar('renderHistory') + '\nreturn renderHistory;')(...chaves.map((k) => deps[k]));
  I18N.setLang(lang);
  try { roda(); } finally { I18N.setLang('pt'); }
  return el.innerHTML;
}
const LINHA = /<div class="flex justify-between items-baseline text-sm py-0\.5"><span class="text-slate-600 dark:text-slate-300">([^<]*)<\/span><span class="tnum font-medium"><span class="sr-only">([^<]*)<\/span><span aria-hidden="true"><span class="text-emerald-700 dark:text-emerald-400">(\d+)<\/span> · <span class="text-rose-600 dark:text-rose-400">(\d+)<\/span><\/span><\/span><\/div>/g;
const ESTATISTICAS = { today: { read: 12, rejected: 1 }, week: { read: 17, rejected: 4 }, month: { read: 1, rejected: 4 }, total: { read: 12345, rejected: 9 } };

test('R21-7-04 · cada linha do Histórico: a frase `sr-only` antes, os números da tela `aria-hidden` — e a frase diz os MESMOS números', () => {
  for (const lang of ['pt', 'en', 'es', 'fr']) {
    const html = linhasDoHistorico({ lang, stats: ESTATISTICAS });
    const linhas = [...html.matchAll(LINHA)];
    assert.equal(linhas.length, 4, `${lang}: esperava as 4 linhas (Hoje, Semana, Mês, Total) no formato novo, achei ${linhas.length}`);
    I18N.setLang(lang);
    try {
      ['today', 'week', 'month', 'total'].forEach((k, i) => {
        const [, rotulo, frase, lidos, rejeitados] = linhas[i];
        assert.equal(rotulo, I18N.t('stats.history.' + k), `${lang}: o rótulo da linha ${k}`);
        const s = ESTATISTICAS[k];
        assert.equal(Number(lidos), s.read, `${lang}/${k}: o número verde da tela mudou`);
        assert.equal(Number(rejeitados), s.rejected, `${lang}/${k}: o número rosa da tela mudou`);
        assert.equal(frase, fraseDoPar(s.read, s.rejected), `${lang}/${k}: a frase não diz os números da tela`);
      });
    } finally { I18N.setLang('pt'); }
    // A contagem sai CRUA, a mesma da tela: 12345, sem separador de milhar em NENHUM idioma.
    assert.ok(linhas[3][2].startsWith('12345 '), `${lang}: a frase formatou a contagem (a tela a mostra crua): ${linhas[3][2]}`);
  }
});

test('R21-7-04 · histórico vazio: nenhuma linha, nenhuma frase solta; e o painel NUNCA lê o par sem o `aria-hidden`', () => {
  const zero = { today: { read: 0, rejected: 0 }, week: { read: 0, rejected: 0 }, month: { read: 0, rejected: 0 }, total: { read: 0, rejected: 0 } };
  const html = linhasDoHistorico({ stats: zero });
  assert.equal([...html.matchAll(LINHA)].length, 0);
  assert.equal(html.includes('sr-only'), false, 'histórico vazio com frase `sr-only` solta');
  // Estrutura: todo `<span class="text-emerald-700…">` / `text-rose-600…` das linhas mora DENTRO do `aria-hidden`.
  const corpo = fatiar('renderHistory');
  assert.ok(corpo.indexOf('<span aria-hidden="true"><span class="text-emerald-700') > corpo.indexOf('class="sr-only"'),
    'os números da tela não estão atrás do `aria-hidden`, depois da frase');
  assert.doesNotMatch(corpo, /toLocaleString/, 'as linhas do Histórico passaram a formatar a contagem');
});

// ═══ D2 · o aviso de sessão que aparece (ou some) refaz a medida do placar ════════════════════════
//
// A vigia do placar (`vigiarPlacar`) observava a grade e os `<p>` das células. O aviso "Sua sessão vence em
// N dias" (`#avisoSessao`) mora DENTRO do `#placar`, FORA da grade: ao aparecer o placar crescia, a pilha do
// card com ele, o 2×2 seguia ligado e a barra ✕ ↑ ✓ passava da janela até o próximo card. O smoke de layout
// mede isso no navegador de verdade (bloco "o aviso de sessão que aparece ou some REFAZ a medida do 2×2").
// Aqui: o `#placar` está entre os alvos do observer, e a decisão acompanha a altura nos DOIS sentidos.
function placarDeMentira({ comPlacar = true } = {}) {
  const classes = new Set();
  const quadros = [];
  const estado = { aviso: false };
  const celulas = [{ children: [{}, { getClientRects: () => [1], clientWidth: 77 }] }];   // rótulo de 90 px numa célula de 77: sobra
  const grade = { isConnected: true, children: celulas, getClientRects: () => [1],
    classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
  // A pilha do card com o 2×2 ligado: 731 sem o aviso, 781 com ele (a janela tem 740); sem o 2×2, 716.
  const pilha = { getBoundingClientRect: () => ({ bottom: classes.has('placar-2x2') ? (estado.aviso ? 781 : 731) : 716 }) };
  const placar = { id: 'placar' };
  const card = {};
  const medidasDaBarra = new WeakMap([[card, { medir() {}, cabe: () => true }]]);
  const document = { getElementById: (id) => ({ placarGrid: grade, cardStack: pilha, placar: comPlacar ? placar : null })[id] || null,
    querySelector: () => card, createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({ width: 90 }) }) };
  class RO { constructor(cb) { this.cb = cb; RO.ultimo = this; this.alvos = []; } observe(a) { this.alvos.push(a); } }
  new Function('document', 'TOLERANCIA_ARREDONDAMENTO_PX', 'requestAnimationFrame', 'ResizeObserver', 'innerHeight', 'window', 'medidasDaBarra',
    'let medirOPlacarDeNovo = () => {};\nlet medirOPlacarComOCardNovo = () => {};\n' + fatiar('vigiarPlacar') + '\nvigiarPlacar();')(
    document, 2, (f) => quadros.push(f), RO, 740, { addEventListener() {} }, medidasDaBarra);
  const rodar = () => { while (quadros.length) quadros.shift()(); };
  return { classes, estado, placar, RO, rodar };
}

test('D2 · a vigia do placar observa o `#placar` inteiro (o aviso de sessão mora nele, fora da grade)', () => {
  const m = placarDeMentira();
  assert.ok(m.RO.ultimo.alvos.includes(m.placar), 'o `#placar` não está entre os alvos do ResizeObserver: o aviso muda a altura e ninguém refaz a conta');
  // CONTROLE: a grade e a célula seguem observadas (o conserto soma, não troca).
  assert.ok(m.RO.ultimo.alvos.length >= 3, `o observer perdeu os alvos de antes (a grade e as células): ${m.RO.ultimo.alvos.length}`);
  // Sem o `#placar` na página (a tela de entrada antes de montar), a vigia liga do mesmo jeito.
  assert.doesNotThrow(() => placarDeMentira({ comPlacar: false }), 'a vigia lançou sem o `#placar` no DOM');
});

test('D2 · o aviso aparece: o 2×2 que deixaria a barra fora da janela DESLIGA; o aviso some: volta — pelo callback do observer', () => {
  const m = placarDeMentira();
  m.rodar();
  assert.ok(m.classes.has('placar-2x2'), 'CONTROLE: sem o aviso a pilha cabe (731 de 740) e o 2×2 devia estar ligado');
  m.estado.aviso = true;      // `atualizarAvisoDeSessao` mostrou o aviso: o `#placar` cresceu
  m.RO.ultimo.cb();           // o que o ResizeObserver do `#placar` faz
  m.rodar();
  assert.equal(m.classes.has('placar-2x2'), false, 'com o aviso a pilha passa da janela (781 de 740) e o 2×2 seguiu ligado');
  m.estado.aviso = false;     // `esquecerPrazoDaSessao`/`guardarPrazoDaSessao` o esconderam
  m.RO.ultimo.cb();
  m.rodar();
  assert.ok(m.classes.has('placar-2x2'), 'o aviso saiu e o 2×2 não voltou sozinho');
});

test('D2 (estrutura): o callback do observer segue só AGENDANDO — o placar inteiro não ganhou escrita síncrona (gotcha #35)', () => {
  const vigia = fatiar('vigiarPlacar');
  const obs = vigia.slice(vigia.indexOf('const obs = new ResizeObserver('), vigia.indexOf("window.addEventListener('resize'"));
  assert.match(obs, /new ResizeObserver\(agendar\)/, 'o observer deixou de chamar só o `agendar`');
  assert.match(obs, /obs\.observe\(placar\)/);
  assert.equal((vigia.match(/new ResizeObserver\(/g) || []).length, 1, 'a vigia ganhou um segundo observer (um só, com todos os alvos)');
});

// ═══ O rótulo do botão do Histórico diz o que a folha oferece ══════════════════════════════════════
//
// O botão dizia "Compartilhar meu resumo de outubro" onde `navigator.canShare({ files })` é falso (um
// computador; o Chromium e o WebKit do Linux), mas a folha só oferecia o "Baixar" — o texto prometia o que
// a tela seguinte não tinha. Agora o botão e a folha fazem a MESMA pergunta (`aparelhoCompartilhaArquivo`),
// e onde o aparelho não compartilha o botão diz "Ver meu resumo de outubro".
const compartilha = (navigator, ClasseFile = File) => new Function('navigator', 'File',
  fatiar('aparelhoCompartilhaArquivo') + '\nreturn aparelhoCompartilhaArquivo;')(navigator, ClasseFile);

test('texto do botão · `aparelhoCompartilhaArquivo`: só com `canShare({ files })` verdadeiro; qualquer falha é "não compartilha"', () => {
  const chamadas = [];
  // O arquivo da pergunta é um PNG de VERDADE (não vazio): a folha perguntava com a imagem real, e um celular que
  // recusasse arquivo de 0 byte tiraria o "Compartilhar" de onde ele funcionava.
  class FileEspiao { constructor(partes, nome, opcoes) { this.partes = partes; this.name = nome; this.type = opcoes && opcoes.type; } }
  assert.equal(compartilha({ canShare: (d) => { chamadas.push(d); return true; } }, FileEspiao)(), true);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].files.length, 1, 'o canShare não recebeu um arquivo');
  assert.equal(chamadas[0].files[0].type, 'image/png', 'o arquivo da pergunta não é PNG (o tipo é o que o canShare confere)');
  assert.match(chamadas[0].files[0].name, /\.png$/);
  const bytes = chamadas[0].files[0].partes[0];
  assert.ok(bytes instanceof Uint8Array && bytes.length > 8, 'o arquivo da pergunta é vazio (ou não são bytes)');
  assert.deepEqual([...bytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'os bytes da pergunta não são de um PNG (a assinatura)');
  assert.equal(compartilha({ canShare: () => 1 })(), true, 'um valor verdadeiro qualquer é "compartilha"');
  assert.equal(compartilha({ canShare: () => false })(), false, 'canShare falso (o computador)');
  assert.equal(compartilha({})(), false, 'sem `canShare` (o WebKit do Linux, navegador velho)');
  assert.equal(compartilha({ canShare: () => { throw new Error('boom'); } })(), false, 'canShare que lança');
  assert.equal(compartilha({ canShare: () => true }, class { constructor() { throw new Error('sem File'); } })(), false, 'sem `File`');
});

// `renderHistory` DE VERDADE com um mês cheio: devolve o texto do botão do Resumo.
function rotuloDoBotaoDoResumo(lang, compartilhaArquivo) {
  const locale = { pt: 'pt-BR', en: 'en', es: 'es', fr: 'fr' }[lang];
  const el = { innerHTML: '', dataset: { conqLigado: '1' }, botao: null, appendChild(b) { this.botao = b; }, insertAdjacentHTML() {}, contains: () => false };
  const document = { getElementById: (id) => (id === 'historyBody' ? el : null), activeElement: null,
    createElement: () => ({ addEventListener() {}, setAttribute() {} }) };
  const deps = { document, getHistoryStats: () => ({ today: { read: 1, rejected: 0 }, week: { read: 1, rejected: 0 }, month: { read: 1, rejected: 0 }, total: { read: 1, rejected: 0 } }),
    renderAutores() {}, chaveDoFoco: () => null, devolverFocoAoPainel() {}, htmlPatente: () => '', htmlConquistas: () => '',
    dadosDoResumo: () => ({ total: 5, ano: 2026, mesIdx: 9 }), loadHistory: () => ({}), i18nLocale: () => locale, ligarConquistas() {}, abrirResumoDoMes() {},
    aparelhoCompartilhaArquivo: () => compartilhaArquivo, t: I18N.t, escapeHtml: (s) => String(s),
    fraseDosLidosERejeitados: () => '' };
  const chaves = Object.keys(deps);
  const roda = new Function(...chaves, fatiar('renderHistory') + '\nreturn renderHistory;')(...chaves.map((k) => deps[k]));
  I18N.setLang(lang);
  try { roda(); } finally { I18N.setLang('pt'); }
  assert.ok(el.botao, 'o botão do Resumo não foi criado com o mês cheio');
  return el.botao.textContent;
}

test('texto do botão · o rótulo segue o aparelho: "Compartilhar…" só onde a folha compartilha, "Ver…" onde ela só baixa — nos 4 idiomas', () => {
  const esperado = {
    pt: ['Compartilhar meu resumo de outubro', 'Ver meu resumo de outubro'],
    en: ['Share my October recap', 'See my October recap'],
    es: ['Compartir mi resumen de octubre', 'Ver mi resumen de octubre'],
    fr: ['Partager mon bilan : octobre', 'Voir mon bilan : octobre'],
  };
  for (const [lang, [comPartilhar, semPartilhar]] of Object.entries(esperado)) {
    assert.equal(rotuloDoBotaoDoResumo(lang, true), comPartilhar, `${lang}: o aparelho compartilha`);
    assert.equal(rotuloDoBotaoDoResumo(lang, false), semPartilhar, `${lang}: o aparelho só baixa (o rótulo prometia compartilhar)`);
  }
});

test('texto do botão · a promessa e a oferta fazem a MESMA pergunta: uma função, e ninguém mais chama `canShare`', () => {
  assert.match(fatiar('renderHistory'), /t\(aparelhoCompartilhaArquivo\(\) \? 'resumo\.botao' : 'resumo\.botaoVer'/, 'o rótulo não depende de `aparelhoCompartilhaArquivo`');
  assert.match(fatiar('abrirResumoDoMes'), /const podeCompartilhar = aparelhoCompartilhaArquivo\(\);/, 'a folha não faz a mesma pergunta');
  // `canShare` só aparece DENTRO da função: duas condições copiadas são como o botão e a folha voltam a discordar.
  const fora = SEM.replace(fatiar('aparelhoCompartilhaArquivo'), '');
  assert.doesNotMatch(fora, /\bcanShare\b/, 'algum outro lugar do app.js pergunta `canShare` por conta própria');
});

test('texto do botão · a chave nova nos 4 idiomas: leva o mês, não promete compartilhar e usa o nome do conceito (resumo/recap/resumen/bilan)', () => {
  const substantivo = { pt: 'resumo', en: 'recap', es: 'resumen', fr: 'bilan' };
  const verboDeCompartilhar = /compartilh|share|compart|partag/i;
  for (const [lang, nome] of Object.entries(substantivo)) {
    I18N.setLang(lang);
    try {
      const ver = I18N.t('resumo.botaoVer', { mes: 'MES' }), comp = I18N.t('resumo.botao', { mes: 'MES' });
      assert.ok(ver.includes('MES'), `${lang}: a chave nova perdeu o {mes}`);
      assert.doesNotMatch(ver, verboDeCompartilhar, `${lang}: "${ver}" ainda promete compartilhar`);
      assert.ok(ver.includes(nome) && comp.includes(nome), `${lang}: o conceito mudou de nome entre o rótulo antigo e o novo ("${comp}" × "${ver}")`);
      assert.match(comp, verboDeCompartilhar, `CONTROLE: o rótulo de antes devia prometer compartilhar (${lang})`);
    } finally { I18N.setLang('pt'); }
  }
});

// ═══ carregarConquistas: `c` e `n` guardados como LISTA (irmão do R20-7-02, lote 24) ═══════════════
//
// `typeof [] === 'object'`: uma lista passava por objeto, as conquistas que se guardam nela (`c.coruja = …`)
// somem no `JSON.stringify` e voltavam a "novas" a cada carga. Só armazenamento editado à mão chega assim.
function conquistasGuardadas(texto) {
  const guardado = new Map(texto === undefined ? [] : [['waze_places_conquistas', texto]]);
  const AppState = { conquistas: null };
  const deps = { AppState, CONQUISTAS_KEY: 'waze_places_conquistas',
    localStorage: { getItem: (k) => (guardado.has(k) ? guardado.get(k) : null), setItem: (k, v) => guardado.set(k, v) },
    copiaEmDia: () => false, lembrarTextoDaCopia() {} };
  const chaves = Object.keys(deps);
  const carregar = new Function(...chaves, fatiar('carregarConquistas') + '\nreturn carregarConquistas;')(...chaves.map((k) => deps[k]));
  return { carregar, AppState };
}

test('carregarConquistas · `c` e `n` em LISTA viram objeto: a conquista nova SOBREVIVE ao `JSON.stringify` (a ida e volta que salvarConquistas faz)', () => {
  for (const texto of ['{"c":["coruja"],"n":[1,2]}', '{"c":[],"n":[]}', '{"c":{"coruja":"2026-10-01"},"n":[3]}', '{"c":["x"],"n":{"rejeitados":7}}']) {
    const m = conquistasGuardadas(texto);
    const g = m.carregar();
    assert.equal(Array.isArray(g.c), false, `${texto}: \`c\` seguiu lista`);
    assert.equal(Array.isArray(g.n), false, `${texto}: \`n\` seguiu lista`);
    g.c.primeiraFaxina = '2026-10-14';
    g.n.rejeitados = 5;
    const volta = JSON.parse(JSON.stringify(g));
    assert.equal(volta.c.primeiraFaxina, '2026-10-14', `DEFEITO: ${texto} — a conquista guardada em \`c\` sumiu no JSON (volta a "nova" a cada carga)`);
    assert.equal(volta.n.rejeitados, 5, `${texto}: o contador guardado em \`n\` sumiu no JSON`);
  }
});

test('carregarConquistas · CONTROLES: o armazenamento de sempre segue igual, e o lixo de outro tipo continua virando `{}`', () => {
  const bom = { c: { coruja: '2026-10-01' }, seq: 4, patente: 2, n: { rejeitados: 7 }, langs: ['pt'], base: true, novas: ['coruja'], patenteNova: true };
  const g = conquistasGuardadas(JSON.stringify(bom)).carregar();
  assert.deepEqual(g, bom, 'o armazenamento válido mudou ao ser lido');
  for (const lixo of ['"x"', '5', 'null', 'true']) {
    const r = conquistasGuardadas(`{"c":${lixo},"n":${lixo}}`).carregar();
    assert.deepEqual([r.c, r.n], [{}, {}], `${lixo}: \`c\`/\`n\` que não são objeto viraram outra coisa`);
  }
  assert.deepEqual(conquistasGuardadas(undefined).carregar().c, {}, 'o aparelho novo');
  assert.deepEqual(conquistasGuardadas('[1,2,3]').carregar().c, {}, 'a raiz em lista (sem `c`)');
});
