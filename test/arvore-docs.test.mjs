// A árvore de arquivos que os documentos MOSTRAM tem que ser a do disco — nos dois sentidos.
//
// O lote 24 dizia "corrige a árvore da seção Estrutura do CLAUDE.md" e ela seguiu incompleta (faltavam
// `tools/diag-tela.mjs`, `gerar-css.mjs` e `gerar-js.mjs`, o `icon-maskable.svg` e o `.github/`), com a
// descrição do `rodar-longo.mjs` pendurada na do `servidor-local.mjs` e a faixa do jitter do `waze-probe`
// de uma versão que o código já não tem (700–2200 ms, hoje 1500–4000 ms em `tools/waze-jitter.mjs`).
// A do README, que é a que o público lê, não tinha `tools/`, `test/`, `extensao-chrome/`, `CHANGELOG.md`,
// `LICENSE`, `tailwind.config.js`, `css/tailwind.src.css`, `icons/icon-maskable.svg` nem `.github/`. E o
// `docs/waze-api.md` dizia que o app usa 6 caminhos REST, marcando o `Issues/Star` como não usado, com o
// "Pular guarda o pedido" mandando a estrela há semanas. Nenhum teste enxergava, porque documento não é código
// (a mesma lição de `tools/migracoes.mjs`: doc que descreve o que já não existe não engana ninguém só até
// alguém acreditar nele).
//
// Quatro perguntas, todas feitas ao DISCO e ao git, nunca à memória de quem escreve o documento:
//   1. tudo que a árvore CITA existe? (o nome que sobrou depois de um arquivo ser apagado ou renomeado);
//   2. nas pastas que a árvore ENUMERA (tem ao menos um filho listado), todo arquivo rastreado está nela?
//      (o arquivo novo que ninguém lembrou de pôr) — `tools/` à parte, com a mensagem própria;
//   3. toda entrada de topo do repositório está nas DUAS árvores?
//   4. os números e os caminhos da API do Waze que o README e o `docs/waze-api.md` citam são os do core?
// Rastreado pelo git (`git ls-files`, como o `.assetsignore` já faz), e não "o que está no disco": o
// `node_modules`, o `.wrangler` e o log de ontem não são do repositório, e quem os deixa lá não precisa
// de uma linha na árvore. O que a árvore diz ser GERADO (`index.html`, `css/app.css`, `js/min/`) é commitado,
// então entra na conta como qualquer outro.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (f) => readFileSync(join(RAIZ, f), 'utf8');
const RASTREADOS = execFileSync('git', ['ls-files', '-z'], { cwd: RAIZ, encoding: 'utf8' }).split('\0').filter(Boolean);

// O primeiro bloco de código depois do título que ancora a árvore.
function blocoDeCodigo(doc, ancora) {
  const t = ler(doc);
  const i = t.indexOf(ancora);
  assert.ok(i >= 0, `${doc}: o título "${ancora}" sumiu — a árvore não tem onde ser lida`);
  const ini = t.indexOf('```\n', i);
  assert.ok(ini > i, `${doc}: não achei o bloco de código depois de "${ancora}"`);
  const fim = t.indexOf('\n```', ini + 4);
  assert.ok(fim > ini, `${doc}: o bloco de código da árvore não fecha`);
  return t.slice(ini + 4, fim);
}

// Cada entrada: { caminho, nome, ehPasta, linha }. A indentação é de 4 colunas por nível ("│   " ou 4 espaços); a
// linha de comentário que continua a descrição de uma entrada não tem "├── " e não conta. "(sem vendor: …)" é
// nota, não arquivo. O nome é a 1ª palavra depois do conector e pode ter barra ("scripts/md2pdf.py").
function lerArvore(texto) {
  const pilha = [];
  const saida = [];
  texto.split('\n').forEach((l, i) => {
    const m = /^((?:│   |    )*)(?:├── |└── )(\S+)/.exec(l);
    if (!m || m[2].startsWith('(')) return;
    const nivel = m[1].length / 4;
    pilha.length = nivel;
    pilha[nivel] = m[2].replace(/\/$/, '');
    saida.push({ caminho: pilha.join('/'), nome: m[2], ehPasta: m[2].endsWith('/'), nivel, linha: i + 1 });
  });
  return saida;
}

const ARVORES = {
  'CLAUDE.md': lerArvore(blocoDeCodigo('CLAUDE.md', '## 📁 Estrutura')),
  'README.md': lerArvore(blocoDeCodigo('README.md', '### Estrutura de arquivos')),
};

// Os filhos DIRETOS de uma pasta, nos arquivos rastreados e na árvore.
const filhosRastreados = (pasta) => new Set(RASTREADOS.filter((f) => f.startsWith(pasta + '/')).map((f) => f.slice(pasta.length + 1).split('/')[0]));
const filhosNaArvore = (arvore, pasta) => new Set(arvore.filter((e) => e.caminho.startsWith(pasta + '/')).map((e) => e.caminho.slice(pasta.length + 1).split('/')[0]));

test('árvores: o instrumento leu as duas (CONTROLE: entradas que têm que estar lá)', () => {
  const claude = ARVORES['CLAUDE.md'];
  const readme = ARVORES['README.md'];
  assert.ok(claude.length >= 60, `a árvore do CLAUDE.md saiu com ${claude.length} entradas — o leitor quebrou, não o documento`);
  assert.ok(readme.length >= 30, `a árvore do README saiu com ${readme.length} entradas — o leitor quebrou, não o documento`);
  for (const [doc, arvore] of Object.entries(ARVORES)) {
    const caminhos = arvore.map((e) => e.caminho);
    for (const c of ['server', 'server/core.mjs', 'js', 'js/app.js', 'js/min', 'css/app.css', 'worker/index.mjs']) {
      assert.ok(caminhos.includes(c), `${doc}: o leitor não achou "${c}" na árvore`);
    }
  }
  // O nome com barra e o nível 2: o leitor tem que montar o caminho inteiro.
  assert.ok(claude.some((e) => e.caminho === 'docs/scripts/md2pdf.py'), 'o leitor não montou docs/scripts/md2pdf.py (nome com barra)');
  // E a nota "(sem vendor …)" não virou arquivo.
  assert.ok(!claude.some((e) => e.nome.startsWith('(')), 'uma nota entre parênteses virou entrada da árvore');
});

for (const doc of ['CLAUDE.md', 'README.md']) {
  test(`árvore do ${doc}: tudo que ela CITA existe`, () => {
    const faltam = ARVORES[doc].filter((e) => !existsSync(join(RAIZ, e.caminho))).map((e) => `${e.caminho} (linha ${e.linha} do bloco)`);
    assert.deepEqual(faltam, [], `${doc} cita o que o disco não tem — apagado ou renomeado sem a árvore saber`);
  });

  test(`árvore do ${doc}: nas pastas que ela ENUMERA, todo arquivo do repositório está nela`, () => {
    const arvore = ARVORES[doc];
    const enumeradas = arvore.filter((e) => e.ehPasta && filhosNaArvore(arvore, e.caminho).size > 0);
    assert.ok(enumeradas.length >= 4, `${doc}: só ${enumeradas.length} pastas enumeradas — o leitor quebrou`);
    const semLinha = [];
    for (const pasta of enumeradas) {
      const citados = filhosNaArvore(arvore, pasta.caminho);
      for (const f of filhosRastreados(pasta.caminho)) if (!citados.has(f)) semLinha.push(`${pasta.caminho}/${f}`);
    }
    assert.deepEqual(semLinha, [], `${doc}: arquivos do repositório SEM linha na árvore (numa pasta que ela enumera)`);
  });

  test(`árvore do ${doc}: toda entrada de TOPO do repositório está nela`, () => {
    const topoRastreado = [...new Set(RASTREADOS.map((f) => f.split('/')[0]))];
    assert.ok(topoRastreado.length >= 20, `achei só ${topoRastreado.length} entradas de topo no git — o instrumento quebrou`);
    const nasArvore = new Set(ARVORES[doc].filter((e) => e.nivel === 0).map((e) => e.caminho));
    const faltam = topoRastreado.filter((t) => !nasArvore.has(t));
    assert.deepEqual(faltam, [], `${doc}: entradas de topo do repositório SEM linha na árvore`);
  });
}

test('árvore do CLAUDE.md: toda ferramenta de tools/ está nela, com a descrição na entrada CERTA', () => {
  const arvore = ARVORES['CLAUDE.md'];
  const tools = RASTREADOS.filter((f) => /^tools\/[^/]+$/.test(f)).map((f) => f.slice('tools/'.length));
  assert.ok(tools.length >= 20 && tools.includes('smoke-browser.mjs'), `achei só ${tools.length} ferramentas — o instrumento quebrou`);
  const citadas = filhosNaArvore(arvore, 'tools');
  assert.deepEqual(tools.filter((t) => !citadas.has(t)), [], 'ferramentas de tools/ SEM linha na árvore do CLAUDE.md');
  // As três que o lote 24 deixou de fora, por nome — a regressão diz qual voltou a faltar.
  for (const t of ['diag-tela.mjs', 'gerar-css.mjs', 'gerar-js.mjs']) assert.ok(citadas.has(t), `tools/${t} voltou a faltar na árvore`);
  // A história do vigia zumbi é do `rodar-longo.mjs`, e a descrição do `servidor-local.mjs` não a leva.
  const texto = blocoDeCodigo('CLAUDE.md', '## 📁 Estrutura');
  const entrada = (nome) => {
    const linhas = texto.split('\n');
    const i = linhas.findIndex((l) => new RegExp(`^│   [├└]── ${nome.replace('.', '\\.')}\\s`).test(l));
    assert.ok(i >= 0, `${nome} não tem entrada`);
    let f = i + 1;
    while (f < linhas.length && !/^│   [├└]── /.test(linhas[f]) && /^│\s/.test(linhas[f])) f++;
    return linhas.slice(i, f).join('\n');
  };
  assert.match(entrada('rodar-longo.mjs'), /VIGIA ZUMBI/, 'a história do vigia zumbi saiu da entrada do rodar-longo');
  assert.doesNotMatch(entrada('servidor-local.mjs'), /VIGIA ZUMBI|\.estado|--esperar/, 'a descrição do rodar-longo voltou a ficar pendurada no servidor-local');
  // A faixa do jitter que o waze-probe usa é a do waze-jitter.mjs.
  const jitter = ler('tools/waze-jitter.mjs');
  const min = /^export const JITTER_MIN_MS = (\d+);/m.exec(jitter)[1];
  const max = /^export const JITTER_MAX_MS = (\d+);/m.exec(jitter)[1];
  assert.match(entrada('waze-probe.mjs'), new RegExp(`\\(${min}–${max}ms`), `a árvore não diz a faixa do jitter do código (${min}–${max} ms)`);
});

test('os caminhos REST do Waze que o app usa: o core, o diagrama do README e o docs/waze-api.md dizem os mesmos', () => {
  const core = ler('server/core.mjs');
  // Um helper por caminho: `const wazeXxxEndpoint = (r) => … + '/Caminho'` (o Features vem de uma tabela própria).
  const helpers = [...core.matchAll(/^const (waze\w+Endpoint) = \(/gm)].map((m) => m[1]);
  assert.ok(helpers.length >= 6, `achei só ${helpers.length} helpers de endpoint no core — o instrumento quebrou`);
  const N = helpers.length;
  const folhas = helpers.map((h) => {
    if (h === 'wazeFeaturesEndpoint') return 'Features';
    const corpo = new RegExp(`^const ${h} = [^\\n]*`, 'm').exec(core)[0];
    const literal = [...corpo.matchAll(/'(\/[A-Za-z/]+)(?:\?[^']*)?'/g)].map((m) => m[1]).pop();
    assert.ok(literal, `${h}: não achei o caminho dele`);
    return literal.slice(1);
  });
  assert.ok(folhas.includes('Issues/Star') && folhas.includes('Session'), `PRÉ-CONDIÇÃO: o extrator não leu os caminhos (${folhas.join(', ')})`);

  // docs/waze-api.md §2: "O app usa **N**", "Os outros M" (= total − N) e as N linhas "**usamos**" da tabela.
  const api = ler('docs/waze-api.md');
  const usa = /O app\s+usa \*\*(\d+)\*\*\. Os outros (\d+)/.exec(api);
  assert.ok(usa, 'docs/waze-api.md: a frase "O app usa **N**. Os outros M" sumiu');
  const total = Number(/São \*\*(\d+) caminhos\*\*/.exec(api)[1]);
  assert.equal(Number(usa[1]), N, `docs/waze-api.md diz que o app usa ${usa[1]} caminhos REST; o core tem ${N} helpers (${folhas.join(', ')})`);
  assert.equal(Number(usa[2]), total - N, `docs/waze-api.md: "Os outros ${usa[2]}" deveria ser ${total} − ${N} = ${total - N}`);
  const secao2 = api.slice(api.indexOf('## 2. REST'), api.indexOf('## 3.'));
  const linhasUsamos = secao2.split('\n').filter((l) => /^\| `[^`]+` \| `[^`]+` \| \*\*usamos\*\*/.test(l));
  assert.equal(linhasUsamos.length, N, `docs/waze-api.md: ${linhasUsamos.length} linhas "**usamos**" na tabela, e o app usa ${N}`);
  for (const f of folhas) {
    const linha = linhasUsamos.find((l) => l.startsWith(`| \`${f.startsWith('Issues/') ? 'v1/' : ''}${f}\``) || l.startsWith(`| \`${f}\``));
    assert.ok(linha, `docs/waze-api.md: "${f}" é usado pelo core e não está entre as linhas "**usamos**"`);
  }

  // README: o diagrama "APIs internas do Waze" nomeia cada um.
  const readme = ler('README.md');
  const diagrama = readme.slice(readme.indexOf('APIs internas do Waze'), readme.indexOf('### Estrutura de arquivos'));
  assert.ok(diagrama.length > 100, 'README: o diagrama "APIs internas do Waze" sumiu');
  for (const f of folhas) {
    const leitura = /^LocationSearch\/(\w+)$/.exec(f);
    const citado = leitura ? new RegExp(`LocationSearch/\\{[^}]*\\b${leitura[1]}\\b`).test(diagrama) : diagrama.includes(f);
    assert.ok(citado, `README: o diagrama das APIs do Waze não cita "${f}", que o core usa`);
  }
});

test('CLAUDE.md: o diff não filtra linha igual? Filtra — o "Aberto" que o gotcha #37 já fechou não volta', () => {
  const core = ler('server/core.mjs');
  // O fato: o core compara o valor CRU e conta o que comparou.
  assert.match(core, /if \(mesmoValor\(venue\[k\] \?\? null, newValue \?\? null\)\) \{\s*camposSemMudanca\+\+;/,
    'PRÉ-CONDIÇÃO: o core deixou de comparar o valor cru (o documento mudou de verdade?)');
  const claude = ler('CLAUDE.md');
  assert.doesNotMatch(claude, /\*\*Aberto\*\*: `changedVenue` não é diff e o app não filtra linha com/,
    'o CLAUDE.md voltou a dizer que o app não filtra linha com `from === to`, e o core a filtra (gotcha #37, v2026.07.30-11)');
  assert.match(claude, /\*\*Resolvido em v2026\.07\.30-11\*\* \(gotcha #37\): o core compara o valor CRU\s+#\s+\(`mesmoValor`\)/,
    'o CLAUDE.md perdeu o registro de que o filtro da linha igual foi entregue');
});
