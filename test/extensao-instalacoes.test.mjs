// O número de instalações da extensão, lido da loja a cada `npm run js` (tools/extensao-instalacoes.mjs).
// A leitura e a reescrita são puras; o `main` recebe a rede e o arquivo por parâmetro, então NENHUM teste vai à internet.
// Cada regra foi vista REPROVANDO com a sabotagem (gotcha #28).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lerInstalacoes, reescreverFonte, numeroDoArquivo, main, URL_DA_LOJA, ID_DA_EXTENSAO } from '../tools/extensao-instalacoes.mjs';

const STATUS = readFileSync(new URL('../js/status.js', import.meta.url), 'utf8');
const PACOTE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// O trecho REAL da página da loja (2026-11-27), com ruído em volta do número.
const PAGINA = '<div class="x">4.6 (12 ratings)</div><a href="/category/extensions/productivity" jsaction="click:x;keydown:y;keyboard_enter">Tools</a>105 users</div><div class="kg">Featured</div>';

test('lerInstalacoes: acha o número da loja, com separador de milhar e o «+», e ignora o que não é o contador', () => {
  assert.equal(lerInstalacoes(PAGINA), 105);
  assert.equal(lerInstalacoes('<a>Tools</a>1,234 users</div>'), 1234);
  assert.equal(lerInstalacoes('<a>Tools</a>10.000+ users</div>'), 10000, 'ponto também é milhar; o «+» não entra no número');
  assert.equal(lerInstalacoes('<span> 7  users </span>'), 7);
  // Ruído que NÃO é o contador: «users» solto em texto, sem o `>` colado, e número sem «users».
  assert.equal(lerInstalacoes('<p>Currently, this extension only for users above level 2</p><p>5 users like it</p>'), null);
  assert.equal(lerInstalacoes('<div>105</div>'), null);
});

test('lerInstalacoes: página estranha vira null, nunca um número inventado', () => {
  for (const ruim of [undefined, null, '', 42, {}, '<a>x</a>0 users</a>', '<a>x</a>99999999999 users</a>', '<a>x</a>abc users</a>']) {
    assert.equal(lerInstalacoes(ruim), null, String(ruim));
  }
});

test('reescreverFonte: troca SÓ a data e o número, e devolve null se uma das linhas sumiu', () => {
  const nova = reescreverFonte(STATUS, 321, '2030-01-02');
  assert.equal(numeroDoArquivo(nova), 321);
  assert.match(nova, /^\/\/ Chrome Web Store, lido em 2030-01-02 /m);
  // Todo o resto do arquivo fica igual.
  const sem = (t) => t.replace(/^\/\/ Chrome Web Store, lido em .*$/m, '').replace(/^const EXTENSAO_INSTALACOES_CHROME = \d+;$/m, '');
  assert.equal(sem(nova), sem(STATUS));
  assert.equal(reescreverFonte(STATUS.replace(/^const EXTENSAO_INSTALACOES_CHROME = \d+;$/m, ''), 1, '2030-01-02'), null, 'sem a linha do número: não grava meia mudança');
  assert.equal(reescreverFonte(STATUS.replace(/^\/\/ Chrome Web Store, lido em .*$/m, ''), 1, '2030-01-02'), null, 'sem a linha da data');
});

test('o js/status.js de verdade tem as DUAS linhas que o build reescreve (senão o build calaria pra sempre)', () => {
  assert.ok(numeroDoArquivo(STATUS) > 0);
  assert.notEqual(reescreverFonte(STATUS, numeroDoArquivo(STATUS) + 1, '2030-01-02'), null);
});

function rodar({ ambiente = {}, resposta = PAGINA, falha = null, fonte = STATUS, hoje = '2030-05-06' } = {}) {
  const gravado = []; const logs = []; let idas = 0;
  const buscar = async (url) => {
    idas++;
    if (falha) throw new Error(falha);
    return { ok: typeof resposta !== 'number', status: typeof resposta === 'number' ? resposta : 200, text: async () => (typeof resposta === 'function' ? resposta(idas) : resposta) };
  };
  return main({ ambiente, buscar, ler: () => fonte, gravar: (p, t) => gravado.push(t), hoje: () => hoje, arquivo: 'js/status.js', log: (m) => logs.push(m) })
    .then((r) => ({ r, gravado, logs, idas: () => idas }));
}

test('main: no CI NÃO busca e NÃO grava (o número da loja reprovaria a conferência dos arquivos gerados)', async () => {
  const { r, gravado, idas } = await rodar({ ambiente: { CI: 'true' } });
  assert.equal(r.acao, 'pulado');
  assert.equal(idas(), 0, 'nenhuma ida à rede');
  assert.equal(gravado.length, 0);
});

test('main: número novo grava (com a data de hoje); número igual não grava', async () => {
  const novo = await rodar({ resposta: '<a>T</a>777 users</div>' });
  assert.equal(novo.r.acao, 'gravado');
  assert.equal(numeroDoArquivo(novo.gravado[0]), 777);
  assert.match(novo.gravado[0], /lido em 2030-05-06/);
  const igual = await rodar({ resposta: `<a>T</a>${numeroDoArquivo(STATUS)} users</div>` });
  assert.equal(igual.r.acao, 'igual');
  assert.equal(igual.gravado.length, 0, 'a data não vira ruído de commit');
});

test('main: NUNCA derruba o build — rede, HTTP ruim, página sem o número, linha sumida', async () => {
  for (const [nome, opcoes, esperado] of [
    ['sem rede', { falha: 'sem rede' }, 'falhou'],
    ['HTTP 503', { resposta: 503 }, 'falhou'],
    ['página sem o número', { resposta: '<html>consentimento</html>' }, 'sem-numero'],
    ['linhas do arquivo mudaram', { fonte: 'const X = 1;' , resposta: PAGINA }, 'falhou'],
  ]) {
    const { r, gravado } = await rodar(opcoes);
    assert.equal(r.acao === 'sem-linhas' ? 'falhou' : r.acao, esperado, nome);
    assert.equal(gravado.length, 0, nome + ': não grava nada');
  }
});

test('main: tenta DE NOVO uma vez quando a loja devolve a variante sem o número', async () => {
  const { r, idas } = await rodar({ resposta: (n) => (n === 1 ? '<html>variante</html>' : '<a>T</a>888 users</div>') });
  assert.equal(r.acao, 'gravado');
  assert.equal(r.n, 888);
  assert.equal(idas(), 2);
  const sempre = await rodar({ resposta: '<html>variante</html>' });
  assert.equal(sempre.idas(), 2, 'e só uma: o build não fica preso na loja');
});

test('o endereço é o da loja, na língua fixa, e o build roda a leitura ANTES de gerar o js', () => {
  assert.match(URL_DA_LOJA, new RegExp(`^https://chromewebstore\\.google\\.com/detail/${ID_DA_EXTENSAO}\\?hl=en$`));
  assert.match(STATUS, /chromewebstore\.google\.com\/detail\/waze-places-rapid-access\/dpinfpcoggnilplfgkpnkhbmfokhnhnn/, 'o status.js cita a mesma extensão');
  assert.match(PACOTE.scripts.js, /^node tools\/extensao-instalacoes\.mjs && node tools\/gerar-js\.mjs$/, 'primeiro a leitura (que reescreve o fonte), depois o min');
});
